//! High-risk commands that get their own typed commands — they do NOT go through `git_exec` (the validator blocks them):
//! arbitrary config writes and remote URLs are command-execution vectors. `git_config_set` (key in `configSetAllowlist`),
//! `git_remote_add` / `git_remote_set_url` (valid remote name, URL through the policy's `url` rules), `git_clone` (validated
//! URL, destination folder chosen with a native dialog), `git_init`. A repo the app created or cloned is trusted outright.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use serde::Deserialize;

use crate::core::{Core, OpEntry, SpawnOptions};
use crate::errors::{AppError, Result};
use crate::exec::{CancelToken, FrameSink, LimitedSink, run_process};
use crate::frames::exit_frame;
use crate::pathutil::{has_git_component, is_windows_reserved_name};
use crate::policy::{EnvProfile, ExecKind, GitPolicy, policy};
use crate::registry::OpenedRepo;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConfigScope {
    Local,
    Global,
}

const MAX_CONFIG_VALUE: usize = 1024;
const MAX_URL: usize = 2048;
const MAX_NAME: usize = 255;

static HELPER_SYNTAX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z][A-Za-z0-9+.-]*::").expect("regex hợp lệ"));
static SCHEME_URL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([A-Za-z][A-Za-z0-9+.-]*)://").expect("regex hợp lệ"));
static REMOTE_NAME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$").expect("regex hợp lệ"));

/// URL protocols accepted when adding a remote / cloning (`git+ssh`, `ssh+git` are ssh variants).
const ALLOWED_SCHEMES: [&str; 7] = ["https", "http", "ssh", "git", "file", "git+ssh", "ssh+git"];

/// Split a config key into (section, subsection?, variable); `None` when invalid.
fn split_key(key: &str) -> Option<(&str, Option<&str>, &str)> {
    let first = key.find('.')?;
    let last = key.rfind('.')?;
    let (section, variable) = (&key[..first], &key[last + 1..]);
    if section.is_empty() || variable.is_empty() {
        return None;
    }
    let subsection = (first != last).then(|| &key[first + 1..last]);
    Some((section, subsection, variable))
}

/// Is the key in `configSetAllowlist`? (a `*` in the subsection matches any non-empty subsection)
pub fn config_key_allowed(policy: &GitPolicy, key: &str) -> bool {
    let Some((section, subsection, variable)) = split_key(key) else { return false };
    if key.chars().any(|c| c.is_control() || c.is_whitespace() || c == '=') {
        return false;
    }
    policy.config_set_allowlist.iter().any(|pattern| {
        let Some((p_section, p_subsection, p_variable)) = split_key(pattern) else { return false };
        section.eq_ignore_ascii_case(p_section)
            && variable.eq_ignore_ascii_case(p_variable)
            && match (p_subsection, subsection) {
                (None, None) => true,
                (Some("*"), Some(sub)) => !sub.is_empty(),
                (Some(expected), Some(sub)) => expected == sub,
                _ => false,
            }
    })
}

fn validate_config_value(value: &str) -> Result<()> {
    if value.len() > MAX_CONFIG_VALUE || value.contains(['\0', '\n', '\r']) {
        return Err(AppError::policy("giá trị cấu hình quá dài hoặc chứa ký tự xuống dòng/NUL"));
    }
    Ok(())
}

/// A valid remote name (a safe subset of `git check-ref-format`; git still validates as the last step).
pub fn validate_remote_name(name: &str) -> Result<()> {
    let bad = !REMOTE_NAME.is_match(name)
        || name.contains("..")
        || name.contains("//")
        || name.ends_with('/')
        || name.ends_with('.')
        || name.ends_with(".lock")
        || name.split('/').any(|part| part.starts_with('.'));
    if bad { Err(AppError::policy(format!("tên remote `{name}` không hợp lệ"))) } else { Ok(()) }
}

/// A remote/clone URL: the policy's `url` rules (`ext::`, `fd::`, starting with `-`) plus: no control characters, no
/// remote-helper syntax `<x>::`, and the protocol must be in the allowlist.
pub fn validate_remote_url(policy: &GitPolicy, url: &str) -> Result<()> {
    if url.is_empty() || url.len() > MAX_URL {
        return Err(AppError::policy("URL rỗng hoặc quá dài"));
    }
    if url.chars().any(char::is_control) || url.trim() != url {
        return Err(AppError::policy("URL chứa ký tự điều khiển hoặc khoảng trắng ở hai đầu"));
    }
    if policy.is_rejected_url(url) {
        return Err(AppError::policy("URL bị chính sách chặn (ext::, fd:: hoặc bắt đầu bằng `-`)"));
    }
    if HELPER_SYNTAX.is_match(url) {
        return Err(AppError::policy("URL dạng `<helper>::…` chạy chương trình ngoài nên bị chặn"));
    }
    if let Some(captures) = SCHEME_URL.captures(url) {
        let scheme = captures[1].to_ascii_lowercase();
        if !ALLOWED_SCHEMES.contains(&scheme.as_str()) {
            return Err(AppError::policy(format!("giao thức `{scheme}` không được hỗ trợ")));
        }
    }
    Ok(())
}

/// Destination folder name: one path component, not `.git`.
pub fn validate_dir_name(name: &str) -> Result<()> {
    let bad = name.is_empty()
        || name.len() > MAX_NAME
        || name == "."
        || name == ".."
        || name.contains(['/', '\\', '\0'])
        || name.chars().any(char::is_control)
        || has_git_component(name)
        || (cfg!(windows) && (name.contains(':') || name.ends_with(['.', ' ']) || is_windows_reserved_name(name)));
    if bad { Err(AppError::policy(format!("tên thư mục `{name}` không hợp lệ"))) } else { Ok(()) }
}

/// Default folder name when cloning from a URL (`https://github.com/a/b.git` → `b`), the port of `defaultDirectoryName`.
pub fn default_clone_dir_name(url: &str) -> String {
    let mut trimmed = url.trim();
    while let Some(rest) = trimmed.strip_suffix('/') {
        trimmed = rest;
    }
    let trimmed = trimmed.strip_suffix(".git").unwrap_or(trimmed);
    let last = trimmed.rsplit(['/', ':', '\\']).next().unwrap_or("");
    if last.is_empty() || validate_dir_name(last).is_err() { "repo".to_string() } else { last.to_string() }
}

impl Core {
    /// `git_config_set`: key in the allowlist, scope `local` (the repo) or `global`.
    pub async fn git_config_set(&self, repo_id: &str, key: &str, value: &str, scope: ConfigScope) -> Result<()> {
        if !config_key_allowed(policy(), key) {
            return Err(AppError::policy(format!("khoá cấu hình `{key}` không nằm trong danh sách cho phép")));
        }
        validate_config_value(value)?;
        let entry = self.registry.get(repo_id)?;
        let (cwd, flag): (&Path, &str) = match scope {
            ConfigScope::Local => (&entry.root, "--local"),
            ConfigScope::Global => (&self.data_dir, "--global"),
        };
        let args = vec![flag.to_string(), "--".to_string(), key.to_string(), value.to_string()];
        let output = self.run_typed(cwd, "config", &args, entry.restrictions.as_ref()).await?;
        if output.ok() { Ok(()) } else { Err(AppError::Io(format!("git config thất bại: {}", output.stderr().trim()))) }
    }

    pub async fn git_remote_add(&self, repo_id: &str, name: &str, url: &str) -> Result<()> {
        self.remote_write(repo_id, "add", name, url).await
    }

    pub async fn git_remote_set_url(&self, repo_id: &str, name: &str, url: &str) -> Result<()> {
        self.remote_write(repo_id, "set-url", name, url).await
    }

    /// The URLs of all of the repo's remotes (read with `git remote -v`, one of the app's read-only commands) — used to learn which hosts a network command touches.
    pub async fn remote_urls(&self, repo_id: &str) -> Result<Vec<String>> {
        let entry = self.registry.get(repo_id)?;
        let output = self.run_typed(&entry.root, "remote", &["-v".into()], entry.restrictions.as_ref()).await?;
        if !output.ok() {
            return Ok(Vec::new());
        }
        Ok(output
            .stdout()
            .lines()
            .filter_map(|line| line.split_whitespace().nth(1))
            .map(|url| url.to_string())
            .collect())
    }

    async fn remote_write(&self, repo_id: &str, action: &str, name: &str, url: &str) -> Result<()> {
        validate_remote_name(name)?;
        validate_remote_url(policy(), url)?;
        let entry = self.registry.get(repo_id)?;
        let args = vec![action.to_string(), "--".to_string(), name.to_string(), url.to_string()];
        let output = self.run_typed(&entry.root, "remote", &args, entry.restrictions.as_ref()).await?;
        if output.ok() { Ok(()) } else { Err(AppError::Io(format!("git remote {action} thất bại: {}", output.stderr().trim()))) }
    }

    async fn run_typed(
        &self,
        cwd: &Path,
        sub: &str,
        args: &[String],
        restrictions: Option<&crate::trust::Restrictions>,
    ) -> Result<crate::core::GitOutput> {
        self.run_git(
            SpawnOptions { cwd, sub, args, stdin: None, profile: EnvProfile::Background, caller_env: BTreeMap::new(), restrictions },
            Some(Duration::from_secs(60)),
        )
        .await
    }

    /// Destination folder from a token + optional sub-name. The token is only consumed on success.
    fn destination(&self, token: &str, name: Option<&str>) -> Result<(PathBuf, PathBuf)> {
        let base = self.registry.peek_grant(token)?;
        let dest = match name {
            Some(name) => {
                validate_dir_name(name)?;
                base.join(name)
            }
            None => base.clone(),
        };
        Ok((base, dest))
    }

    /// `git_init`: create a new repo (default branch `main` unless the user set `init.defaultBranch`) and open it (trusted).
    pub async fn git_init(&self, token: &str, name: Option<&str>) -> Result<OpenedRepo> {
        let (_, dest) = self.destination(token, name)?;
        std::fs::create_dir_all(&dest).map_err(|e| AppError::io("Tạo thư mục repo", &e))?;
        let configured = self.run_typed(&dest, "config", &["--global".into(), "--get".into(), "init.defaultBranch".into()], None).await?;
        let mut args: Vec<String> = Vec::new();
        if configured.stdout().trim().is_empty() {
            args.push("--initial-branch=main".into());
        }
        let output = self.run_typed(&dest, "init", &args, None).await?;
        if !output.ok() {
            return Err(AppError::Io(format!("git init thất bại: {}", output.stderr().trim())));
        }
        let entry = self.open_path(&dest, true).await?;
        self.registry.touch_recent(&entry.root);
        self.registry.forget_grant(token);
        Ok(entry.opened())
    }

    /// `git_clone`: stream progress (stderr) into `sink`, cancellable (a `network` command), then open the repo (trusted).
    /// The `exit` frame is always sent last, even when the clone fails or is cancelled.
    #[allow(clippy::too_many_arguments)]
    pub async fn git_clone(
        self: &Arc<Self>,
        window: &str,
        url: &str,
        token: &str,
        name: Option<&str>,
        op_id: &str,
        sink: Arc<dyn FrameSink>,
        detached: Arc<AtomicBool>,
    ) -> Result<OpenedRepo> {
        validate_op_id_public(op_id)?;
        validate_remote_url(policy(), url)?;
        let dir_name = match name {
            Some(name) => name.to_string(),
            None => default_clone_dir_name(url),
        };
        let (base, dest) = self.destination(token, Some(&dir_name))?;
        if dest.exists() && std::fs::read_dir(&dest).map(|mut d| d.next().is_some()).unwrap_or(true) {
            return Err(AppError::Conflict(format!("Thư mục đích `{}` đã tồn tại và không rỗng", dest.display())));
        }
        let existed_before = dest.exists();
        let git = self.locator.current()?;
        if git.too_old || git.blocks("clone") {
            return Err(AppError::GitTooOld(git.warning.clone().unwrap_or_else(|| "Phiên bản git không đạt sàn bảo mật".into())));
        }
        let args = vec!["--progress".to_string(), "--".to_string(), url.to_string(), dest.to_string_lossy().into_owned()];
        let askpass = self.askpass.get().map(|server| server.session(window, op_id, "git clone"));
        self.refresh_tokens_for(std::slice::from_ref(&url.to_string())).await;
        let credential = self.credential_session(std::slice::from_ref(&url.to_string()));
        let mut spec = self.build_spec_with(
            &git,
            SpawnOptions { cwd: &base, sub: "clone", args: &args, stdin: None, profile: EnvProfile::Interactive, caller_env: BTreeMap::new(), restrictions: None },
            askpass.as_ref(),
            credential.as_ref(),
        );
        let _ssh_agent = self.ssh_agent_for(std::slice::from_ref(&url.to_string()), &git, &mut spec).await;
        let cancel = CancelToken::new();
        let (_op, _guard) = self.register_op(OpEntry {
            id: op_id.to_string(),
            window: window.to_string(),
            kind: ExecKind::Network,
            repo_id: None,
            common_key: None,
            cancel: cancel.clone(),
            detached: detached.clone(),
        })?;
        // A malicious host can flood stderr with unbounded sideband messages: cap it like `git_exec`.
        let limited = Arc::new(LimitedSink::new(sink.clone(), self.exec_output_limit, cancel.clone()));
        let exit = run_process(spec, limited.clone(), Some(cancel), self.timing).await?;
        if (exit.code != 0 || limited.exceeded()) && !existed_before && dest.exists() {
            // Clean up the half-finished directory this very clone created (a SIGKILLed git has no time to clean up).
            let _ = std::fs::remove_dir_all(&dest);
        }
        sink.send(exit_frame(exit.code, exit.cancelled));
        if limited.exceeded() {
            return Err(AppError::Io(format!("Output của git clone vượt giới hạn {} MiB nên đã bị dừng", limited.limit() / (1024 * 1024))));
        }
        if exit.cancelled {
            return Err(AppError::Io("Đã huỷ clone".into()));
        }
        if exit.code != 0 {
            return Err(AppError::Io(format!("git clone thất bại (mã {})", exit.code)));
        }
        let entry = self.open_path(&dest, true).await?;
        self.registry.touch_recent(&entry.root);
        self.registry.forget_grant(token);
        Ok(entry.opened())
    }
}

fn validate_op_id_public(id: &str) -> Result<()> {
    crate::core::validate_op_id(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{TestRepo, core_with, open};

    #[test]
    fn config_key_allowlist_with_branch_glob() {
        let p = policy();
        for key in [
            "user.name", "user.email", "USER.Name", "pull.rebase", "pull.ff", "init.defaultBranch", "push.autoSetupRemote",
            "branch.main.remote", "branch.feature/x.merge", "branch.a.b.c.rebase", "branch.main.REMOTE",
        ] {
            assert!(config_key_allowed(p, key), "{key}");
        }
        for key in [
            "core.fsmonitor", "core.hooksPath", "core.sshCommand", "alias.x", "credential.helper", "filter.x.clean", "include.path",
            "branch.main.pushremote", "branch..remote", "branch.remote", "user", "user.", ".name", "user.name\n", "user.na me",
            "branch.x.remote=evil", "url.x.insteadOf", "remote.origin.url", "diff.external", "",
        ] {
            assert!(!config_key_allowed(p, key), "{key:?}");
        }
    }

    #[test]
    fn config_values_must_be_single_line() {
        assert!(validate_config_value("Phan Thái").is_ok());
        assert!(validate_config_value("-x").is_ok());
        for bad in ["a\nb", "a\rb", "a\0b"] {
            assert!(validate_config_value(bad).is_err());
        }
        assert!(validate_config_value(&"x".repeat(MAX_CONFIG_VALUE + 1)).is_err());
    }

    #[test]
    fn remote_names() {
        for good in ["origin", "upstream", "fork-1", "my.remote", "team/fork", "a_b"] {
            assert!(validate_remote_name(good).is_ok(), "{good}");
        }
        for bad in ["", "-x", "--upload-pack=x", ".hidden", "a..b", "a//b", "a/", "a.", "x.lock", "a b", "a\nb", "a;b", "$(x)", "team/.x", "é"] {
            assert!(validate_remote_name(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn remote_urls_follow_the_policy_url_rules_and_more() {
        let p = policy();
        for good in [
            "https://github.com/HoangThai18/thaigit.git", "http://example.com/a.git", "ssh://git@host/x.git", "git@github.com:a/b.git",
            "git://host/x.git", "file:///srv/repos/x.git", "/srv/repos/x.git", "../relative/x.git", "C:\\repos\\x.git", "HTTPS://Host/x",
            "/Users/a/My Repo.git", "git+ssh://host/x",
        ] {
            assert!(validate_remote_url(p, good).is_ok(), "{good}");
        }
        for bad in [
            "", "ext::sh -c id", "EXT::sh", "fd::17", "-oProxyCommand=evil", "--upload-pack=x", "hg::https://x", "s3::bucket/x", "ftp://host/x",
            "javascript://x", "https://host/x\nfoo", "https://host/x\0", " https://host/x", "https://host/x ", "ext::",
        ] {
            assert!(validate_remote_url(p, bad).is_err(), "{bad:?}");
        }
        assert!(validate_remote_url(p, &format!("https://h/{}", "a".repeat(MAX_URL))).is_err());
    }

    #[test]
    fn default_directory_names_port_the_swift_helper() {
        for (url, expected) in [
            ("https://github.com/a/b.git", "b"),
            ("https://github.com/a/b/", "b"),
            ("git@github.com:a/thaigit.git", "thaigit"),
            ("/srv/repos/proj.git", "proj"),
            ("https://host/", "host"),
            ("", "repo"),
            ("https://github.com/a/..", "repo"),
        ] {
            assert_eq!(default_clone_dir_name(url), expected, "{url}");
        }
    }

    #[test]
    fn directory_names_are_single_safe_components() {
        for good in ["repo", "thư mục", "a.b", "my-repo_2"] {
            assert!(validate_dir_name(good).is_ok(), "{good}");
        }
        for bad in ["", ".", "..", "a/b", "a\\b", ".git", "x/.git", "GIT~1", ".git.", "a\0b", "a\nb"] {
            assert!(validate_dir_name(bad).is_err(), "{bad:?}");
        }
    }

    #[tokio::test]
    async fn config_set_writes_local_and_global_but_only_allowlisted_keys() {
        let repo = TestRepo::new();
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        let id = &opened.repo_id;

        core.git_config_set(id, "user.name", "Phan Thái", ConfigScope::Local).await.unwrap();
        assert_eq!(repo.git(&["config", "--local", "--get", "user.name"]).trim(), "Phan Thái");
        // a value starting with `-` is not read as an option
        core.git_config_set(id, "user.email", "-weird@example.com", ConfigScope::Local).await.unwrap();
        assert_eq!(repo.git(&["config", "--local", "--get", "user.email"]).trim(), "-weird@example.com");
        core.git_config_set(id, "branch.feature/x.remote", "origin", ConfigScope::Local).await.unwrap();
        assert_eq!(repo.git(&["config", "--get", "branch.feature/x.remote"]).trim(), "origin");
        core.git_config_set(id, "init.defaultBranch", "trunk", ConfigScope::Global).await.unwrap();
        assert_eq!(repo.git(&["config", "--global", "--get", "init.defaultBranch"]).trim(), "trunk");
        assert!(!repo.git(&["config", "--local", "--list"]).contains("init.defaultbranch"));

        for key in ["core.fsmonitor", "core.sshCommand", "alias.pwn", "credential.helper", "core.hooksPath"] {
            let error = core.git_config_set(id, key, "touch /tmp/pwned", ConfigScope::Local).await.unwrap_err();
            assert_eq!(error.code(), "policy", "{key}");
            let error = core.git_config_set(id, key, "x", ConfigScope::Global).await.unwrap_err();
            assert_eq!(error.code(), "policy", "{key}");
        }
        assert!(repo.git_raw(&["config", "--get", "core.fsmonitor"]).0 != 0);
        assert_eq!(core.git_config_set(id, "user.name", "a\nb", ConfigScope::Local).await.unwrap_err().code(), "policy");
    }

    #[tokio::test]
    async fn remote_add_and_set_url_validate_name_and_url() {
        let repo = TestRepo::new();
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        let id = &opened.repo_id;

        core.git_remote_add(id, "origin", "https://github.com/a/b.git").await.unwrap();
        assert_eq!(repo.git(&["remote", "get-url", "origin"]).trim(), "https://github.com/a/b.git");
        core.git_remote_set_url(id, "origin", "git@github.com:a/b.git").await.unwrap();
        assert_eq!(repo.git(&["remote", "get-url", "origin"]).trim(), "git@github.com:a/b.git");
        core.git_remote_add(id, "local", "/srv/repos/x.git").await.unwrap();

        for url in ["ext::sh -c touch% /tmp/pwned", "fd::17", "-oProxyCommand=evil", "hg::x"] {
            assert_eq!(core.git_remote_add(id, "evil", url).await.unwrap_err().code(), "policy", "{url}");
            assert_eq!(core.git_remote_set_url(id, "origin", url).await.unwrap_err().code(), "policy", "{url}");
        }
        for name in ["--upload-pack=x", "-v", "a b", ".x", ""] {
            assert_eq!(core.git_remote_add(id, name, "https://h/x").await.unwrap_err().code(), "policy", "{name:?}");
        }
        assert_eq!(repo.git(&["remote", "get-url", "origin"]).trim(), "git@github.com:a/b.git", "URL cũ không đổi sau khi bị chặn");
        assert!(!repo.git(&["remote"]).contains("evil"));
        // a duplicate name → git reports the error and Rust turns it into io
        assert_eq!(core.git_remote_add(id, "origin", "https://h/x").await.unwrap_err().code(), "io");
    }

    fn make_bare_remote(tmp: &Path) -> PathBuf {
        let seed = TestRepo::new();
        seed.write("README.md", "# demo\n");
        seed.write("src/lib.rs", "pub fn x() {}\n");
        seed.commit_all("Khởi tạo");
        let bare = tmp.join("remote.git");
        seed.git(&["clone", "-q", "--bare", &seed.root().to_string_lossy(), &bare.to_string_lossy()]);
        bare
    }

    #[tokio::test]
    async fn init_creates_a_trusted_repo_on_main() {
        let repo = TestRepo::new();
        let (core, _data) = core_with(&repo).await;
        let parent = repo.tmp().join("projects");
        std::fs::create_dir_all(&parent).unwrap();
        let picked = core.registry.grant_folder(&parent);
        let opened = core.git_init(&picked.token, Some("moi")).await.unwrap();
        assert_eq!(opened.trust, "trusted");
        assert!(parent.join("moi/.git").is_dir());
        assert_eq!(std::fs::read_to_string(parent.join("moi/.git/HEAD")).unwrap().trim(), "ref: refs/heads/main");
        assert!(core.registry.peek_grant(&picked.token).is_err(), "token bị huỷ sau khi thành công");
        assert_eq!(core.registry.recent_list()[0].name, "moi");
        let bad = core.registry.grant_folder(&parent);
        assert_eq!(core.git_init(&bad.token, Some("../escape")).await.unwrap_err().code(), "policy");
        assert_eq!(core.git_init("không-có", None).await.unwrap_err().code(), "not-found");
    }

    #[tokio::test]
    async fn clone_streams_progress_opens_the_repo_and_rejects_bad_input() {
        let repo = TestRepo::new();
        let (core, _data) = core_with(&repo).await;
        let bare = make_bare_remote(repo.tmp());
        let parent = repo.tmp().join("clones");
        std::fs::create_dir_all(&parent).unwrap();
        let picked = core.registry.grant_folder(&parent);
        let sink = Arc::new(crate::exec::CollectSink::default());
        let url = bare.to_string_lossy().into_owned();
        let opened = core
            .git_clone("main", &url, &picked.token, Some("ban-sao"), "clone-1", sink.clone(), crate::registry::new_detach_flag())
            .await
            .unwrap();
        assert_eq!(opened.trust, "trusted");
        assert!(parent.join("ban-sao/README.md").is_file());
        let out = sink.collect();
        assert_eq!(out.exit.map(|e| (e.code, e.cancelled)), Some((0, false)));
        assert!(out.stderr_text().contains("Cloning into"), "{}", out.stderr_text());
        assert!(core.ops.is_empty(), "op được gỡ khỏi bảng");

        // the destination already exists and is not empty
        let again = core.registry.grant_folder(&parent);
        let error = core
            .git_clone("main", &url, &again.token, Some("ban-sao"), "clone-2", sink.clone(), crate::registry::new_detach_flag())
            .await
            .unwrap_err();
        assert_eq!(error.code(), "conflict");
        // a bad URL / name is blocked before git runs
        for bad in ["ext::sh -c touch% /tmp/pwned", "-oProxyCommand=evil", "fd::3"] {
            let error = core.git_clone("main", bad, &again.token, Some("x"), "clone-3", sink.clone(), crate::registry::new_detach_flag()).await.unwrap_err();
            assert_eq!(error.code(), "policy", "{bad}");
        }
        let error = core.git_clone("main", &url, &again.token, Some(".git"), "clone-4", sink.clone(), crate::registry::new_detach_flag()).await.unwrap_err();
        assert_eq!(error.code(), "policy");
        // a failure (nonexistent source): the exit frame is still sent and the half-finished directory is cleaned up
        let failing = Arc::new(crate::exec::CollectSink::default());
        let error = core
            .git_clone("main", "/không/có/repo.git", &again.token, Some("loi"), "clone-5", failing.clone(), crate::registry::new_detach_flag())
            .await
            .unwrap_err();
        assert_eq!(error.code(), "io");
        assert_ne!(failing.collect().exit.unwrap().code, 0);
        assert!(!parent.join("loi").exists());
    }
}
