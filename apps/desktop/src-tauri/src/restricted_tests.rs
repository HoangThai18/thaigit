//! Trust gate end-to-end với git THẬT: repo lạ có khoá/hook chạy lệnh → mở không chạy gì, chế độ hạn chế vô hiệu hoá TỪNG
//! LOẠI khoá (mỗi test có "đối chứng": cùng cấu hình chạy bằng git trần thì lệnh có chạy), tin tưởng thì mở khoá.
//! Mọi "lệnh của repo" chỉ là script `touch <marker>` trong thư mục tạm — không có gì nguy hiểm thật sự.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use crate::core::{Core, SpawnOptions};
use crate::exec::Collected;
use crate::policy::{EnvProfile, ExecKind};
use crate::registry::OpenedRepo;
use crate::testutil::{TestRepo, core_with, make_executable, open, request, run};

struct Fx {
    repo: TestRepo,
    core: Arc<Core>,
    _data: tempfile::TempDir,
}

impl Fx {
    async fn new() -> Self {
        let repo = TestRepo::new();
        repo.write("a.txt", "một\nhai\nba\n");
        repo.commit_all("init");
        let (core, data) = core_with(&repo).await;
        Self { repo, core, _data: data }
    }

    fn marker(&self, name: &str) -> PathBuf {
        self.repo.tmp().join(format!("marker-{name}"))
    }

    fn ran(&self, name: &str) -> bool {
        self.marker(name).exists()
    }

    fn clear(&self, name: &str) {
        let _ = std::fs::remove_file(self.marker(name));
    }

    /// Script thực thi được: `touch marker` rồi chạy `rest`.
    fn script(&self, name: &str, rest: &str) -> PathBuf {
        let path = self.repo.tmp().join(format!("script-{name}.sh"));
        std::fs::write(&path, format!("#!/bin/sh\ntouch '{}'\n{rest}\n", self.marker(name).display())).unwrap();
        make_executable(&path);
        path
    }

    fn config(&self, key: &str, value: &str) {
        self.repo.git(&["config", key, value]);
    }

    async fn open(&self) -> OpenedRepo {
        open(&self.core, &self.repo).await
    }

    async fn exec(&self, opened: &OpenedRepo, op: &str, kind: ExecKind, sub: &str, args: &[&str]) -> Collected {
        let (result, sink) = run(&self.core, "main", request(&opened.repo_id, op, kind, sub, args)).await;
        result.unwrap_or_else(|e| panic!("{sub} {args:?}: {e}"));
        sink.collect()
    }

    /// Lệnh git nội bộ (không qua validate) với đúng ghi đè của repo — dùng cho lệnh mà chính sách không cho JS gọi.
    async fn internal(&self, opened: &OpenedRepo, sub: &str, args: &[&str], profile: EnvProfile, stdin: Option<&str>) -> Collected {
        let entry = self.core.registry.get(&opened.repo_id).unwrap();
        let entry = self.core.fresh_entry(entry).await.unwrap();
        let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        let output = self
            .core
            .run_git(
                SpawnOptions {
                    cwd: &entry.root,
                    sub,
                    args: &args,
                    stdin: stdin.map(|s| s.as_bytes().to_vec()),
                    profile,
                    caller_env: Default::default(),
                    restrictions: entry.restrictions.as_ref(),
                },
                Some(Duration::from_secs(30)),
            )
            .await
            .unwrap();
        output.collected
    }
}

#[tokio::test]
async fn opening_a_repo_with_command_running_config_runs_nothing() {
    let fx = Fx::new().await;
    for (name, key) in [("fsm", "core.fsmonitor"), ("ssh", "core.sshCommand"), ("askpass", "core.askpass"), ("proxy", "core.gitProxy"), ("pager", "core.pager"), ("editor", "core.editor")] {
        let script = fx.script(name, "exit 0");
        fx.config(key, &script.to_string_lossy());
    }
    for (name, key) in [("clean", "filter.x.clean"), ("smudge", "filter.x.smudge"), ("textconv", "diff.x.textconv"), ("merge", "merge.x.driver"), ("cred", "credential.helper")] {
        let script = fx.script(name, "exit 0");
        fx.config(key, &format!("sh {}", script.display()));
    }
    fx.repo.write_bytes(".git/hooks/pre-commit", b"#!/bin/sh\nexit 0\n");
    make_executable(&fx.repo.root().join(".git/hooks/pre-commit"));
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");
    for expected in ["core.fsmonitor", "core.sshcommand", "core.askpass", "core.gitproxy", "filter.x.clean", "filter.x.smudge", "diff.x.textconv", "merge.x.driver", "credential.helper", "hook: pre-commit"] {
        assert!(opened.findings.iter().any(|f| f.starts_with(expected)), "thiếu phát hiện {expected}: {:?}", opened.findings);
    }
    for name in ["fsm", "ssh", "askpass", "proxy", "pager", "editor", "clean", "smudge", "textconv", "merge", "cred"] {
        assert!(!fx.ran(name), "mở repo không được chạy `{name}`");
    }
}

#[tokio::test]
async fn repo_without_command_running_keys_opens_trusted_and_silent() {
    let fx = Fx::new().await;
    fx.config("core.autocrlf", "false");
    fx.config("branch.main.remote", "origin");
    fx.repo.write_bytes(".git/hooks/pre-commit.sample", b"#!/bin/sh\n");
    let opened = fx.open().await;
    assert_eq!(opened.trust, "trusted");
    assert!(opened.findings.is_empty());
    assert!(opened.root.ends_with("repo"));
    assert_eq!(opened.git_dir, opened.common_dir);
}

#[tokio::test]
async fn hooks_never_run_before_trust_and_run_after() {
    let fx = Fx::new().await;
    let hook = fx.repo.root().join(".git/hooks/pre-commit");
    std::fs::copy(fx.script("hook", "exit 0"), &hook).unwrap();
    make_executable(&hook);
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");
    let out = fx.exec(&opened, "c1", ExecKind::Write, "commit", &["--allow-empty", "-m", "chưa tin"]).await;
    assert_eq!(out.exit.unwrap().code, 0, "{}", out.stderr_text());
    assert!(!fx.ran("hook"), "hook của repo lạ không được chạy");
    // đối chứng: git trần chạy hook
    assert_eq!(fx.repo.git_raw(&["commit", "-q", "--allow-empty", "-m", "đối chứng"]).0, 0);
    assert!(fx.ran("hook"), "đối chứng: hook có chạy khi không có chế độ hạn chế");
    fx.clear("hook");
    // tin tưởng → hook chạy
    let trusted = fx.core.trust_repo(&opened.repo_id).await.unwrap();
    assert_eq!(trusted.trust, "trusted");
    fx.exec(&trusted, "c2", ExecKind::Write, "commit", &["--allow-empty", "-m", "đã tin"]).await;
    assert!(fx.ran("hook"), "sau khi tin cậy, hook chạy bình thường");
}

#[tokio::test]
async fn core_hooks_path_pointing_at_a_repo_directory_is_overridden() {
    let fx = Fx::new().await;
    let dir = fx.repo.root().join("evil-hooks");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::copy(fx.script("hookspath", "exit 0"), dir.join("pre-commit")).unwrap();
    make_executable(&dir.join("pre-commit"));
    fx.config("core.hooksPath", &dir.to_string_lossy());
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");
    fx.exec(&opened, "c1", ExecKind::Write, "commit", &["--allow-empty", "-m", "x"]).await;
    assert!(!fx.ran("hookspath"));
    assert_eq!(fx.repo.git_raw(&["commit", "-q", "--allow-empty", "-m", "đối chứng"]).0, 0);
    assert!(fx.ran("hookspath"), "đối chứng");
}

#[tokio::test]
async fn fsmonitor_command_never_runs_even_after_trust() {
    let fx = Fx::new().await;
    let script = fx.script("fsm", "printf '/\\0'");
    fx.config("core.fsmonitor", &script.to_string_lossy());
    fx.repo.write("a.txt", "đã sửa\n");
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");
    assert!(!fx.ran("fsm"));
    let out = fx.exec(&opened, "s1", ExecKind::Read, "status", &["--porcelain=v2"]).await;
    assert!(out.stdout_text().contains("a.txt"));
    assert!(!fx.ran("fsm"), "`-c core.fsmonitor=false` luôn bật");
    let trusted = fx.core.trust_repo(&opened.repo_id).await.unwrap();
    fx.exec(&trusted, "s2", ExecKind::Read, "status", &["--porcelain=v2"]).await;
    assert!(!fx.ran("fsm"), "kể cả sau khi tin cậy");
    // đối chứng
    fx.repo.git(&["status", "--porcelain"]);
    assert!(fx.ran("fsm"), "đối chứng: git trần chạy lệnh fsmonitor");
}

#[tokio::test]
async fn filter_clean_smudge_and_process_are_neutralised_in_restricted_mode() {
    let fx = Fx::new().await;
    fx.repo.write(".gitattributes", "*.txt filter=x\n");
    fx.repo.git(&["add", ".gitattributes"]);
    fx.repo.git(&["commit", "-q", "-m", "attrs"]);
    for (name, key) in [("clean", "filter.x.clean"), ("smudge", "filter.x.smudge")] {
        let script = fx.script(name, "cat");
        fx.config(key, &format!("sh {}", script.display()));
    }
    let process = fx.script("process", "exit 1");
    fx.config("filter.x.process", &format!("sh {}", process.display()));
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");

    // clean: git add
    fx.repo.write("a.txt", "thay đổi 1\n");
    let out = fx.exec(&opened, "f1", ExecKind::Write, "add", &["--", "a.txt"]).await;
    assert_eq!(out.exit.unwrap().code, 0, "{}", out.stderr_text());
    assert!(!fx.ran("clean") && !fx.ran("process"), "clean/process của repo lạ không được chạy");
    // smudge: git checkout -- (ghi lại file ở working tree)
    fx.repo.write("a.txt", "thay đổi 2\n");
    fx.exec(&opened, "f2", ExecKind::Write, "checkout", &["--", "a.txt"]).await;
    assert!(!fx.ran("smudge"), "smudge của repo lạ không được chạy");

    // đối chứng bằng git trần (mỗi loại phải có tác dụng thật)
    fx.repo.write("a.txt", "thay đổi 3\n");
    let _ = fx.repo.git_raw(&["add", "a.txt"]);
    assert!(fx.ran("clean") || fx.ran("process"), "đối chứng: bộ lọc chạy khi không có chế độ hạn chế");
    let _ = fx.repo.git_raw(&["checkout", "--", "a.txt"]);
    assert!(fx.ran("smudge") || fx.ran("process"), "đối chứng: smudge/process chạy khi không có chế độ hạn chế");
}

#[tokio::test]
async fn textconv_and_external_diff_drivers_are_neutralised() {
    let fx = Fx::new().await;
    fx.repo.write(".gitattributes", "*.txt diff=x\n");
    fx.repo.git(&["add", ".gitattributes"]);
    fx.repo.git(&["commit", "-q", "-m", "attrs"]);
    let textconv = fx.script("textconv", "cat \"$1\"");
    fx.config("diff.x.textconv", &format!("sh {}", textconv.display()));
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");
    // `cat-file --textconv` không đi qua `--no-textconv` của chính sách nên kiểm đúng cơ chế ghi đè.
    let out = fx.internal(&opened, "cat-file", &["--textconv", "HEAD:a.txt"], EnvProfile::Background, None).await;
    assert!(out.exit.is_some());
    assert!(!fx.ran("textconv"), "textconv của repo lạ bị vô hiệu (git báo lỗi thay vì chạy lệnh của repo)");
    assert_eq!(fx.repo.git_raw(&["cat-file", "--textconv", "HEAD:a.txt"]).0, 0);
    assert!(fx.ran("textconv"), "đối chứng: git trần chạy textconv");
    // diff thông thường qua chính sách luôn thêm --no-textconv --no-ext-diff
    fx.clear("textconv");
    fx.repo.write("a.txt", "khác\n");
    fx.exec(&opened, "d1", ExecKind::Read, "diff", &["--cached"]).await;
    fx.exec(&opened, "d2", ExecKind::Read, "diff", &[]).await;
    let trusted = fx.core.trust_repo(&opened.repo_id).await.unwrap();
    fx.exec(&trusted, "d3", ExecKind::Read, "diff", &[]).await;
    assert!(!fx.ran("textconv"), "không bao giờ chạy textconv, kể cả khi đã tin cậy");
}

#[tokio::test]
async fn custom_merge_driver_is_replaced_by_a_failing_one_so_conflicts_surface() {
    let fx = Fx::new().await;
    fx.repo.write(".gitattributes", "a.txt merge=x\n");
    fx.repo.git(&["add", ".gitattributes"]);
    fx.repo.git(&["commit", "-q", "-m", "attrs"]);
    fx.repo.git(&["checkout", "-q", "-b", "feat"]);
    fx.repo.write("a.txt", "MỘT\nhai\nba\n");
    fx.repo.commit_all("feat");
    fx.repo.git(&["checkout", "-q", "main"]);
    fx.repo.write("a.txt", "một\nhai\nBA\n");
    fx.repo.commit_all("main");
    let driver = fx.script("merge", "exit 0");
    fx.config("merge.x.driver", &format!("sh {} %O %A %B", driver.display()));
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");
    let out = fx.exec(&opened, "m1", ExecKind::Write, "merge", &["--no-edit", "feat"]).await;
    assert_ne!(out.exit.unwrap().code, 0, "driver giả `false` → báo xung đột thay vì coi như gộp xong");
    assert!(!fx.ran("merge"), "merge driver của repo lạ không được chạy");
    fx.exec(&opened, "m2", ExecKind::Write, "merge", &["--abort"]).await;
    // đối chứng
    let _ = fx.repo.git_raw(&["merge", "--no-edit", "feat"]);
    assert!(fx.ran("merge"), "đối chứng: git trần chạy merge driver");
}

#[tokio::test]
async fn credential_helpers_are_reset_and_askpass_is_blanked() {
    let fx = Fx::new().await;
    let helper = fx.script("cred", "exit 0");
    fx.config("credential.helper", &format!("!sh {}", helper.display()));
    let askpass = fx.script("askpass", "echo bí-mật");
    fx.config("core.askpass", &askpass.to_string_lossy());
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");
    let query = "protocol=https\nhost=example.com\n\n";
    // hồ sơ interactive: không có GIT_ASKPASS của Thaigit nên `core.askpass` của repo sẽ được dùng nếu không bị ghi đè
    let out = fx.internal(&opened, "credential", &["fill"], EnvProfile::Interactive, Some(query)).await;
    assert!(out.exit.is_some());
    assert!(!fx.ran("cred"), "credential.helper của repo lạ bị đặt lại");
    assert!(!fx.ran("askpass"), "core.askpass của repo lạ bị xoá");
    let (_, _, _) = fx.repo.git_stdin(&["credential", "fill"], query);
    assert!(fx.ran("cred"), "đối chứng: helper chạy với git trần");
    assert!(fx.ran("askpass"), "đối chứng: askpass chạy với git trần");
}

#[tokio::test]
async fn user_credential_helpers_survive_the_reset() {
    let fx = Fx::new().await;
    // helper của người dùng (global) phải còn dùng được, helper của repo thì không.
    let user_helper = fx.script("user-cred", "if [ \"$1\" = get ]; then echo username=tôi; echo password=mật-khẩu; fi");
    std::fs::write(fx.repo.home().join(".gitconfig"), format!("[credential]\n\thelper = !sh {}\n", user_helper.display())).unwrap();
    let repo_helper = fx.script("repo-cred", "exit 0");
    fx.config("credential.helper", &format!("!sh {}", repo_helper.display()));
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");
    let out = fx.internal(&opened, "credential", &["fill"], EnvProfile::Interactive, Some("protocol=https\nhost=example.com\n\n")).await;
    assert!(out.stdout_text().contains("password=mật-khẩu"), "{}", out.stdout_text());
    assert!(fx.ran("user-cred"), "helper của người dùng vẫn chạy");
    assert!(!fx.ran("repo-cred"), "helper của repo không chạy");
}

#[tokio::test]
async fn ssh_command_and_git_proxy_are_neutralised_for_network_ops() {
    let fx = Fx::new().await;
    let ssh = fx.script("ssh", "exit 255");
    fx.config("core.sshCommand", &ssh.to_string_lossy());
    let proxy = fx.script("proxy", "exit 1");
    fx.config("core.gitProxy", &proxy.to_string_lossy());
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");
    let out = fx.exec(&opened, "n1", ExecKind::Network, "ls-remote", &["ssh://127.0.0.1:1/x"]).await;
    assert_ne!(out.exit.unwrap().code, 0);
    assert!(!fx.ran("ssh"), "core.sshCommand của repo lạ không được chạy");
    let out = fx.exec(&opened, "n2", ExecKind::Network, "ls-remote", &["git://example.invalid/x"]).await;
    assert_ne!(out.exit.unwrap().code, 0);
    assert!(!fx.ran("proxy"), "core.gitProxy của repo lạ không được chạy");
    // đối chứng
    let _ = fx.repo.git_raw(&["ls-remote", "ssh://127.0.0.1:1/x"]);
    assert!(fx.ran("ssh"), "đối chứng: sshCommand chạy với git trần");
    let _ = fx.repo.git_raw(&["ls-remote", "git://example.invalid/x"]);
    assert!(fx.ran("proxy"), "đối chứng: gitProxy chạy với git trần");
}

#[tokio::test]
async fn custom_upload_and_receive_pack_block_network_until_trusted() {
    // git chỉ nhận giá trị đầu tiên của `remote.<tên>.uploadpack` nên không ghi đè bằng `-c`/GIT_CONFIG được: chặn mạng.
    let fx = Fx::new().await;
    let bare = fx.repo.tmp().join("remote.git");
    fx.repo.git(&["clone", "-q", "--bare", &fx.repo.root().to_string_lossy(), &bare.to_string_lossy()]);
    fx.repo.git(&["remote", "add", "origin", &bare.to_string_lossy()]);
    let up = fx.script("uploadpack", "exec git upload-pack \"$@\"");
    fx.config("remote.origin.uploadpack", &up.to_string_lossy());
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");
    for (op, kind, sub, args) in [
        ("n1", ExecKind::Network, "ls-remote", vec!["origin"]),
        ("n2", ExecKind::Network, "fetch", vec!["origin"]),
        ("n3", ExecKind::Network, "push", vec!["origin", "main"]),
        ("n4", ExecKind::Write, "remote", vec!["prune", "origin"]),
        ("n5", ExecKind::Write, "remote", vec!["show", "origin"]),
        ("n6", ExecKind::Write, "remote", vec!["set-head", "origin", "-a"]),
    ] {
        let (result, sink) = run(&fx.core, "main", request(&opened.repo_id, op, kind, sub, &args)).await;
        assert_eq!(result.unwrap_err().code(), "untrusted", "{sub} {args:?}");
        assert!(sink.frames().is_empty());
    }
    assert!(!fx.ran("uploadpack"), "không có gì chạy trước khi tin cậy");
    // lệnh cục bộ vẫn chạy; remote chỉ-đọc (get-url) không liên lạc máy chủ nên không bị chặn
    fx.exec(&opened, "l1", ExecKind::Read, "remote", &["get-url", "origin"]).await;
    // đối chứng + sau khi tin cậy thì dùng được
    assert_eq!(fx.repo.git_raw(&["ls-remote", "origin"]).0, 0);
    assert!(fx.ran("uploadpack"), "đối chứng: upload-pack tuỳ chỉnh chạy với git trần");
    fx.clear("uploadpack");
    let trusted = fx.core.trust_repo(&opened.repo_id).await.unwrap();
    let out = fx.exec(&trusted, "n7", ExecKind::Network, "ls-remote", &["origin"]).await;
    assert_eq!(out.exit.unwrap().code, 0, "{}", out.stderr_text());
    assert!(fx.ran("uploadpack"));
}

#[tokio::test]
async fn remote_helper_vcs_override_fails_closed() {
    let fx = Fx::new().await;
    // `remote.origin.vcs = evil` làm git chạy chương trình `git-remote-evil` trong PATH.
    let helper = fx.repo.bin().join("git-remote-evil");
    std::fs::write(&helper, format!("#!/bin/sh\ntouch '{}'\nexit 1\n", fx.marker("vcs").display())).unwrap();
    make_executable(&helper);
    fx.config("remote.origin.url", "file:///khong/ton/tai.git");
    fx.config("remote.origin.vcs", "evil");
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");
    let out = fx.exec(&opened, "v1", ExecKind::Network, "ls-remote", &["origin"]).await;
    assert_ne!(out.exit.unwrap().code, 0);
    assert!(!fx.ran("vcs"), "remote helper do `remote.<tên>.vcs` chỉ định không được chạy");
    let _ = fx.repo.git_raw(&["ls-remote", "origin"]);
    assert!(fx.ran("vcs"), "đối chứng: git trần chạy helper");
}

#[tokio::test]
async fn gpg_program_of_an_untrusted_repo_is_not_executed() {
    let fx = Fx::new().await;
    let gpg = fx.script("gpg", "exit 1");
    fx.config("gpg.program", &gpg.to_string_lossy());
    fx.config("commit.gpgsign", "true");
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");
    let _ = fx.exec(&opened, "g1", ExecKind::Write, "commit", &["--allow-empty", "-m", "ký"]).await;
    assert!(!fx.ran("gpg"), "gpg.program của repo lạ không được chạy");
    let _ = fx.repo.git_raw(&["commit", "-q", "--allow-empty", "-m", "đối chứng"]);
    assert!(fx.ran("gpg"), "đối chứng");
}

#[tokio::test]
async fn ext_transport_is_blocked_by_the_hard_flag_even_when_the_repo_allows_it() {
    let fx = Fx::new().await;
    fx.config("protocol.ext.allow", "always");
    fx.config("remote.origin.url", &format!("ext::sh -c touch% {}", fx.marker("ext").display()));
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");
    let out = fx.exec(&opened, "e1", ExecKind::Network, "ls-remote", &["origin"]).await;
    assert_ne!(out.exit.unwrap().code, 0);
    assert!(!fx.ran("ext"));
    let trusted = fx.core.trust_repo(&opened.repo_id).await.unwrap();
    let out = fx.exec(&trusted, "e2", ExecKind::Network, "ls-remote", &["origin"]).await;
    assert_ne!(out.exit.unwrap().code, 0);
    assert!(!fx.ran("ext"), "`-c protocol.ext.allow=never` luôn bật, kể cả khi đã tin cậy");
    let _ = fx.repo.git_raw(&["ls-remote", "origin"]);
    assert!(fx.ran("ext"), "đối chứng: git trần chạy lệnh ext::");
}

#[tokio::test]
async fn unneutralisable_keys_and_background_fetch_block_network_in_restricted_mode() {
    let fx = Fx::new().await;
    let bare = fx.repo.tmp().join("remote.git");
    fx.repo.git(&["clone", "-q", "--bare", &fx.repo.root().to_string_lossy(), &bare.to_string_lossy()]);
    fx.repo.git(&["remote", "add", "origin", &bare.to_string_lossy()]);
    fx.config("url.https://evil.example/.insteadOf", "https://github.com/");
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");
    let (result, sink) = run(&fx.core, "main", request(&opened.repo_id, "n1", ExecKind::Network, "fetch", &["origin"])).await;
    assert_eq!(result.unwrap_err().code(), "untrusted");
    assert!(sink.frames().is_empty());
    // lệnh đọc/ghi cục bộ vẫn chạy trong chế độ hạn chế
    fx.exec(&opened, "r1", ExecKind::Read, "status", &["--porcelain=v2"]).await;
    fx.exec(&opened, "w1", ExecKind::Write, "commit", &["--allow-empty", "-m", "cục bộ"]).await;
    // tin tưởng → fetch được
    let trusted = fx.core.trust_repo(&opened.repo_id).await.unwrap();
    let out = fx.exec(&trusted, "n2", ExecKind::Network, "fetch", &["origin"]).await;
    assert_eq!(out.exit.unwrap().code, 0, "{}", out.stderr_text());

    // repo chưa tin cậy (khoá vô hiệu hoá được) cho lệnh mạng thủ công nhưng KHÔNG cho auto-fetch
    let fx = Fx::new().await;
    let bare = fx.repo.tmp().join("remote.git");
    fx.repo.git(&["clone", "-q", "--bare", &fx.repo.root().to_string_lossy(), &bare.to_string_lossy()]);
    fx.repo.git(&["remote", "add", "origin", &bare.to_string_lossy()]);
    let script = fx.script("hook", "exit 0");
    std::fs::copy(&script, fx.repo.root().join(".git/hooks/post-merge")).unwrap();
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");
    let mut auto = request(&opened.repo_id, "auto", ExecKind::Network, "fetch", &["--all"]);
    auto.profile = Some(EnvProfile::Background);
    assert_eq!(run(&fx.core, "main", auto).await.0.unwrap_err().code(), "untrusted", "không auto-fetch ở chế độ hạn chế");
    let out = fx.exec(&opened, "manual", ExecKind::Network, "fetch", &["origin"]).await;
    assert_eq!(out.exit.unwrap().code, 0, "fetch thủ công vẫn chạy được");
}

#[tokio::test]
async fn config_changed_after_opening_is_picked_up_before_the_next_command() {
    let fx = Fx::new().await;
    fx.repo.write_bytes(".git/hooks/pre-commit", b"#!/bin/sh\nexit 0\n");
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");
    // sau khi mở, một tiến trình khác thêm bộ lọc chạy lệnh vào .git/config
    let script = fx.script("late", "cat");
    fx.repo.write(".gitattributes", "*.txt filter=late\n");
    std::thread::sleep(Duration::from_millis(20));
    fx.config("filter.late.clean", &format!("sh {}", script.display()));
    fx.repo.write("a.txt", "đổi\n");
    let out = fx.exec(&opened, "l1", ExecKind::Write, "add", &["--", "a.txt"]).await;
    assert_eq!(out.exit.unwrap().code, 0);
    assert!(!fx.ran("late"), "cấu hình thêm sau khi mở vẫn bị vô hiệu hoá (quét lại khi file cấu hình đổi)");
}

#[tokio::test]
async fn trust_is_remembered_per_path_and_asked_again_when_the_key_set_changes() {
    let fx = Fx::new().await;
    let script = fx.script("ssh", "exit 1");
    fx.config("core.sshCommand", &script.to_string_lossy());
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");
    fx.core.trust_repo(&opened.repo_id).await.unwrap();
    // phiên mới (cùng thư mục dữ liệu): đã nhớ
    let again = Core::for_tests(fx._data.path(), fx.repo.env()).await;
    assert_eq!(open(&again, &fx.repo).await.trust, "trusted");
    // đổi giá trị khoá chạy lệnh → hỏi lại
    fx.config("core.sshCommand", "touch /tmp/khác");
    assert_eq!(open(&again, &fx.repo).await.trust, "unknown");
    // thêm khoá mới → hỏi lại
    fx.config("core.sshCommand", &script.to_string_lossy());
    assert_eq!(open(&again, &fx.repo).await.trust, "trusted");
    fx.config("core.fsmonitor", "x");
    assert_eq!(open(&again, &fx.repo).await.trust, "unknown");
}

#[tokio::test]
async fn open_repo_resolves_subfolders_worktrees_and_rejects_non_repos() {
    let fx = Fx::new().await;
    fx.repo.write("src/deep/x.rs", "x");
    // mở thư mục con → gốc repo
    let sub = fx.repo.root().join("src/deep");
    let picked = fx.core.registry.grant_folder(&sub);
    let opened = fx.core.open_repo(crate::registry::OpenSource::Picked { token: picked.token }).await.unwrap();
    assert!(opened.root.ends_with("repo"), "{}", opened.root);
    assert!(opened.git_dir.ends_with(".git"));
    // cùng repo → cùng repoId
    assert_eq!(fx.open().await.repo_id, opened.repo_id);
    // worktree liên kết: gitDir riêng, commonDir chung → cùng khoá
    fx.repo.git(&["branch", "wt-branch"]);
    let wt = fx.repo.tmp().join("wt");
    fx.repo.git(&["worktree", "add", "-q", &wt.to_string_lossy(), "wt-branch"]);
    let picked = fx.core.registry.grant_folder(&wt);
    let wt_opened = fx.core.open_repo(crate::registry::OpenSource::Picked { token: picked.token }).await.unwrap();
    assert_ne!(wt_opened.repo_id, opened.repo_id);
    assert_eq!(wt_opened.common_dir, opened.common_dir);
    assert_ne!(wt_opened.git_dir, wt_opened.common_dir);
    let key_a = fx.core.registry.get(&opened.repo_id).unwrap().common_key.clone();
    let key_b = fx.core.registry.get(&wt_opened.repo_id).unwrap().common_key.clone();
    assert_eq!(key_a, key_b, "khoá theo commonDir chung cho mọi worktree");
    // không phải repo
    let plain = fx.repo.tmp().join("plain");
    std::fs::create_dir_all(&plain).unwrap();
    let picked = fx.core.registry.grant_folder(&plain);
    assert_eq!(fx.core.open_repo(crate::registry::OpenSource::Picked { token: picked.token }).await.unwrap_err().code(), "not-found");
    // token đã dùng / bịa
    assert_eq!(fx.core.open_repo(crate::registry::OpenSource::Picked { token: "bịa".into() }).await.unwrap_err().code(), "not-found");
    // danh sách gần đây
    let recent = fx.core.registry.recent_list();
    assert!(recent.iter().any(|r| r.id == opened.repo_id));
    let reopened = fx.core.open_repo(crate::registry::OpenSource::Recent { id: opened.repo_id.clone() }).await.unwrap();
    assert_eq!(reopened.repo_id, opened.repo_id);
}

#[tokio::test]
async fn recent_entry_for_a_deleted_folder_is_forgotten() {
    let repo = TestRepo::new();
    let (core, _data) = core_with(&repo).await;
    let opened = open(&core, &repo).await;
    assert!(core.registry.recent_list().iter().any(|r| r.id == opened.repo_id));
    std::fs::remove_dir_all(repo.root()).unwrap();
    let error = core.open_repo(crate::registry::OpenSource::Recent { id: opened.repo_id.clone() }).await.unwrap_err();
    assert_eq!(error.code(), "not-found");
    assert!(!core.registry.recent_list().iter().any(|r| r.id == opened.repo_id), "mục không còn tồn tại bị bỏ khỏi danh sách");
}

// --- cấu hình đổi hiệu lực SAU lần quét: `include` tới file đã track, `includeIf onbranch:` -------------------------------------
//
// Ghi đè của chế độ hạn chế dựng từ lần quét lúc mở. Hai đường làm lần quét đó cũ đi mà `.git/config` không đổi: nội dung file
// được include (đã track) đổi khi chuyển nhánh, hoặc `includeIf onbranch:` bật/tắt theo HEAD.

/// Repo có `.gitattributes` (đã track) ánh xạ `*.x` vào bộ lọc `evil`; nhánh `evil` định nghĩa `filter.evil.clean` trong `file`.
/// Trả về tên marker của script (chạy = bộ lọc đã được thực thi). Đang đứng ở `main`, file vô hại, CHƯA có khoá include nào.
fn evil_branch_fixture(fx: &Fx, file: &str) -> &'static str {
    fx.repo.write(file, "[x]\n\ta = 1\n");
    fx.repo.write(".gitattributes", "*.x filter=evil\n");
    fx.repo.commit_all("seed");
    fx.repo.git(&["checkout", "-q", "-b", "evil"]);
    let script = fx.script("evil-clean", "cat");
    fx.repo.write(file, &format!("[filter \"evil\"]\n\tclean = sh {}\n", script.display()));
    fx.repo.commit_all("evil seed");
    fx.repo.git(&["checkout", "-q", "main"]);
    "evil-clean"
}

#[tokio::test]
async fn include_of_a_tracked_file_cannot_smuggle_a_filter_in_through_a_branch_switch() {
    let fx = Fx::new().await;
    let marker = evil_branch_fixture(&fx, "seed.inc");
    fx.config("include.path", "../seed.inc");
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown", "include.path là khoá cần hỏi tin cậy");
    assert!(opened.findings.iter().any(|f| f.starts_with("include.path")), "{:?}", opened.findings);

    // Người dùng chuyển nhánh ở terminal: `.git/config` không đổi nhưng cấu hình hiệu lực đã có `filter.evil.clean`.
    fx.repo.git(&["checkout", "-q", "evil"]);
    fx.repo.write("payload.x", "dữ liệu\n");
    let (result, sink) = run(&fx.core, "main", request(&opened.repo_id, "a1", ExecKind::Write, "add", &["--", "payload.x"])).await;
    assert!(!fx.ran(marker), "bộ lọc của repo lạ không được chạy (chế độ hạn chế bị vượt qua sau khi chuyển nhánh)");
    assert_eq!(result.unwrap_err().code(), "untrusted", "lệnh có thể chạy bộ lọc bị chặn tới khi tin tưởng");
    assert!(sink.frames().is_empty());
    // đối chứng: git trần chạy bộ lọc (mỗi loại phải có tác dụng thật)
    fx.repo.git(&["add", "payload.x"]);
    assert!(fx.ran(marker), "đối chứng: bộ lọc chạy khi không có chế độ hạn chế");
}

#[tokio::test]
async fn include_if_onbranch_cannot_switch_a_filter_on_by_changing_head() {
    let fx = Fx::new().await;
    // MỘT file tĩnh (không cần track) định nghĩa bộ lọc; chỉ `includeIf onbranch:evil` kéo nó vào.
    fx.repo.write(".gitattributes", "*.x filter=evil\n");
    fx.repo.commit_all("attrs");
    fx.repo.git(&["branch", "evil"]);
    let script = fx.script("static-clean", "cat");
    std::fs::write(fx.repo.root().join("static.inc"), format!("[filter \"evil\"]\n\tclean = sh {}\n", script.display())).unwrap();
    fx.config("includeIf.onbranch:evil.path", "../static.inc");
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");
    assert!(opened.findings.iter().all(|f| !f.starts_with("filter.")), "trên main file chưa được include: {:?}", opened.findings);

    fx.repo.git(&["checkout", "-q", "evil"]);
    fx.repo.write("payload.x", "dữ liệu\n");
    let (result, _) = run(&fx.core, "main", request(&opened.repo_id, "a1", ExecKind::Write, "add", &["--", "payload.x"])).await;
    assert!(!fx.ran("static-clean"), "bộ lọc kéo vào bởi includeIf onbranch: không được chạy");
    assert_eq!(result.unwrap_err().code(), "untrusted");
    fx.repo.git(&["add", "payload.x"]);
    assert!(fx.ran("static-clean"), "đối chứng: includeIf onbranch:evil kéo bộ lọc vào khi HEAD = evil");
}

#[tokio::test]
async fn fail_closed_repo_still_allows_plain_object_reads_and_everything_after_trust() {
    let fx = Fx::new().await;
    let marker = evil_branch_fixture(&fx, "seed.inc");
    fx.config("include.path", "../seed.inc");
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");
    let id = opened.repo_id.as_str();

    // Đọc thuần tuý (không thể chạy bộ lọc/driver/gpg): chạy được.
    for (op, sub, args) in [
        ("p1", "log", vec!["-z", "--format=%H%x1f%s", "--all"]),
        ("p2", "rev-parse", vec!["--verify", "HEAD"]),
        ("p3", "for-each-ref", vec!["--format=%(refname)"]),
        ("p4", "cat-file", vec!["-p", "HEAD"]),
        ("p5", "ls-files", vec!["-z", "--cached"]),
        ("p6", "show", vec!["--stat", "HEAD"]),
        ("p7", "config", vec!["--get", "user.name"]),
        ("p8", "diff-tree", vec!["-r", "--root", "HEAD"]),
    ] {
        let out = fx.exec(&opened, op, ExecKind::Read, sub, &args).await;
        assert_eq!(out.exit.unwrap().code, 0, "{sub} {args:?}: {}", out.stderr_text());
    }
    // Mọi lệnh có thể chạy lệnh do cấu hình chỉ định: bị chặn với mã `untrusted` (UI → "Tin tưởng repo để tiếp tục").
    for (op, kind, sub, args) in [
        ("b1", ExecKind::Read, "status", vec!["--porcelain=v2"]),
        ("b2", ExecKind::Read, "diff", vec![]),
        ("b3", ExecKind::Read, "diff", vec!["--cached"]),
        ("b4", ExecKind::Write, "add", vec!["-A"]),
        ("b5", ExecKind::Write, "checkout", vec!["evil"]),
        ("b6", ExecKind::Write, "switch", vec!["evil"]),
        ("b7", ExecKind::Write, "restore", vec!["--", "a.txt"]),
        ("b8", ExecKind::Write, "stash", vec!["push"]),
        ("b9", ExecKind::Write, "merge", vec!["evil"]),
        ("b10", ExecKind::Write, "rebase", vec!["evil"]),
        ("b11", ExecKind::Write, "cherry-pick", vec!["evil"]),
        ("b12", ExecKind::Write, "revert", vec!["HEAD"]),
        ("b13", ExecKind::Write, "commit", vec!["--allow-empty", "-m", "x"]),
        ("b14", ExecKind::Write, "reset", vec!["--hard"]),
        ("b15", ExecKind::Read, "ls-files", vec!["-m"]),
        ("b16", ExecKind::Read, "ls-files", vec!["--modified"]),
        ("b18", ExecKind::Read, "cat-file", vec!["--filters", "HEAD:a.txt"]),
        ("b19", ExecKind::Write, "tag", vec!["v1"]),
        ("b20", ExecKind::Network, "fetch", vec!["--all"]),
    ] {
        let (result, sink) = run(&fx.core, "main", request(id, op, kind, sub, &args)).await;
        assert_eq!(result.unwrap_err().code(), "untrusted", "{sub} {args:?}");
        assert!(sink.frames().is_empty());
    }
    assert!(!fx.ran(marker));

    // Tin tưởng: tập khoá hiện tại được chấp nhận nên mọi lệnh chạy lại.
    let trusted = fx.core.trust_repo(id).await.unwrap();
    assert_eq!(trusted.trust, "trusted");
    let out = fx.exec(&trusted, "t1", ExecKind::Read, "status", &["--porcelain=v2"]).await;
    assert_eq!(out.exit.unwrap().code, 0);
    // ...nhưng nội dung được include đổi sau đó (chuyển nhánh) thì lần mở sau phải hỏi lại vì tập khoá đã khác.
    fx.repo.git(&["checkout", "-q", "evil"]);
    let reopened = open(&fx.core, &fx.repo).await;
    assert_eq!(reopened.trust, "unknown", "tập khoá chạy lệnh đã đổi (có filter.evil.clean) → hỏi lại");
    assert!(reopened.findings.iter().any(|f| f.starts_with("filter.evil.clean")), "{:?}", reopened.findings);
}

#[tokio::test]
async fn gpg_program_from_a_branch_dependent_include_is_pinned_before_it_can_appear() {
    // `log --format=%G?` chạy `gpg.program` cho commit có chữ ký; khoá nằm trong file include nên lần quét lúc mở không thấy.
    let fx = Fx::new().await;
    fx.repo.git(&["branch", "evil"]);
    // commit mang header `gpgsig` giả: đủ để git thử kiểm chữ ký (gọi chương trình gpg)
    let head = fx.repo.git(&["rev-parse", "HEAD"]).trim().to_string();
    let tree = fx.repo.git(&["rev-parse", "HEAD^{tree}"]).trim().to_string();
    let commit = format!(
        "tree {tree}\nparent {head}\nauthor T <t@e.x> 1700000000 +0000\ncommitter T <t@e.x> 1700000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n iQEzBAABCAAdFiEE\n -----END PGP SIGNATURE-----\n\nsigned\n"
    );
    let (code, sha, error) = fx.repo.git_stdin(&["hash-object", "-t", "commit", "-w", "--stdin"], &commit);
    assert_eq!(code, 0, "{error}");
    fx.repo.git(&["update-ref", "refs/heads/signed", sha.trim()]);
    let gpg = fx.script("gpg", "exit 1");
    std::fs::write(fx.repo.root().join("static.inc"), format!("[gpg]\n\tprogram = {}\n", gpg.display())).unwrap();
    fx.config("includeIf.onbranch:evil.path", "../static.inc");
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");
    fx.repo.git(&["checkout", "-q", "evil"]);
    // đối chứng: git trần (HEAD = evil nên includeIf bật) chạy gpg.program của repo
    let _ = fx.repo.git_raw(&["log", "-1", "--format=%H %G?", "signed"]);
    assert!(fx.ran("gpg"), "đối chứng: git trần chạy gpg.program");
    fx.clear("gpg");

    // Ghi đè dựng từ một lần quét CŨ (lúc đó file include chưa kéo khoá gpg nào vào): chỉ nhờ ghim sẵn mà chương trình không chạy.
    let stale = crate::trust::build_restrictions(&[], &fx.core.empty_hooks_dir);
    let entry = fx.core.registry.get(&opened.repo_id).unwrap();
    let output = fx
        .core
        .run_git(
            SpawnOptions {
                cwd: &entry.root,
                sub: "log",
                args: &["-1".to_string(), "--format=%H %G?".to_string(), "signed".to_string()],
                stdin: None,
                profile: EnvProfile::Background,
                caller_env: Default::default(),
                restrictions: Some(&stale),
            },
            Some(Duration::from_secs(30)),
        )
        .await
        .unwrap();
    assert!(output.stdout().contains(sha.trim()), "lệnh log phải chạy xong: {}", output.stdout());
    assert!(!fx.ran("gpg"), "gpg.program được ghim sẵn nên chương trình của repo không bao giờ chạy, kể cả khi lần quét đã cũ");
    // và qua đường chính thức
    let out = fx.exec(&opened, "g1", ExecKind::Read, "log", &["-1", "--format=%H %G?", "signed"]).await;
    assert!(out.exit.is_some());
    assert!(!fx.ran("gpg"));
}

/// Mọi file `file:` mà `git config --list --show-origin` báo (kể cả file include, config global) và HEAD phải nằm trong vân tay.
#[tokio::test]
async fn fingerprint_covers_every_show_origin_file_the_include_targets_and_head() {
    let fx = Fx::new().await;
    fx.repo.write("seed.inc", "[x]\n\ta = 1\n");
    let absolute = fx.repo.tmp().join("absolute.inc");
    std::fs::write(&absolute, "[y]\n\tb = 2\n").unwrap();
    std::fs::write(fx.repo.home().join(".gitconfig"), "[core]\n\tsshCommand = ssh -i mine\n").unwrap();
    fx.config("include.path", "../seed.inc");
    fx.config("includeIf.onbranch:main.path", &absolute.to_string_lossy());
    fx.config("includeIf.onbranch:no-such-branch.path", "../absent.inc");
    let opened = fx.open().await;
    let entry = fx.core.registry.get(&opened.repo_id).unwrap();

    // Danh sách origin theo đúng lệnh quét (git THẬT), phân giải từ gốc repo như lần quét.
    let (_, raw, _) = fx.repo.git_raw(&["config", "--list", "--show-scope", "--show-origin", "-z"]);
    let entries = crate::trust::parse_config_list(raw.as_bytes());
    let origins: Vec<PathBuf> = entries
        .iter()
        .filter_map(|e| e.origin.strip_prefix("file:"))
        .map(|p| entry.root.join(p))
        .filter_map(|p| crate::pathutil::canonical(&p).ok())
        .collect();
    assert!(origins.len() >= 4, "cần ít nhất config repo, seed.inc, absolute.inc và config global: {origins:?}");
    let watched: Vec<PathBuf> = entry.fingerprint.paths().filter_map(|p| crate::pathutil::canonical(p).ok()).collect();
    for origin in &origins {
        assert!(watched.contains(origin), "vân tay thiếu {origin:?}; đang theo dõi {watched:?}");
    }
    assert!(origins.iter().any(|o| o.ends_with("seed.inc")) && origins.iter().any(|o| o.ends_with("absolute.inc")) && origins.iter().any(|o| o.ends_with(".gitconfig")));
    // HEAD (cho includeIf onbranch:) và đích include CHƯA tồn tại (git bỏ qua nó nên không có trong origin) cũng được theo dõi.
    let all: Vec<&Path> = entry.fingerprint.paths().collect();
    assert!(all.iter().any(|p| p.ends_with(".git/HEAD")), "{all:?}");
    assert!(all.iter().any(|p| p.ends_with("absent.inc")), "{all:?}");
}

#[tokio::test]
async fn untrusted_entry_is_rescanned_when_head_an_included_file_or_the_global_config_changes() {
    let fx = Fx::new().await;
    fx.repo.write("seed.inc", "[x]\n\ta = 1\n");
    fx.config("include.path", "../seed.inc");
    fx.config("core.sshCommand", "touch /tmp/never-run");
    std::fs::write(fx.repo.home().join(".gitconfig"), "[core]\n\tsshCommand = ssh -i A\n").unwrap();
    let opened = fx.open().await;
    let entry = fx.core.registry.get(&opened.repo_id).unwrap();
    let ssh = |e: &crate::registry::RepoEntry| e.restrictions.as_ref().unwrap().config.iter().find(|(k, _)| k == "core.sshcommand").map(|(_, v)| v.clone());
    assert_eq!(ssh(&entry).as_deref(), Some("ssh -i A"));

    let same = fx.core.fresh_entry(entry.clone()).await.unwrap();
    assert!(Arc::ptr_eq(&entry, &same), "không có gì đổi → không quét lại");
    // HEAD đổi (chuyển nhánh)
    fx.repo.git(&["checkout", "-q", "-b", "other"]);
    let after_head = fx.core.fresh_entry(same.clone()).await.unwrap();
    assert!(!Arc::ptr_eq(&same, &after_head), "HEAD đổi → quét lại");
    // file được include đổi nội dung (cùng độ dài: chỉ băm nội dung phát hiện được nếu mtime trùng)
    fx.repo.write("seed.inc", "[x]\n\ta = 2\n");
    let after_include = fx.core.fresh_entry(after_head.clone()).await.unwrap();
    assert!(!Arc::ptr_eq(&after_head, &after_include), "file include đổi → quét lại");
    // config global đổi → giá trị trung tính của người dùng được cập nhật theo
    assert_eq!(ssh(&after_include).as_deref(), Some("ssh -i A"));
    std::fs::write(fx.repo.home().join(".gitconfig"), "[core]\n\tsshCommand = ssh -i B\n").unwrap();
    let after_global = fx.core.fresh_entry(after_include.clone()).await.unwrap();
    assert!(!Arc::ptr_eq(&after_include, &after_global));
    assert_eq!(ssh(&after_global).as_deref(), Some("ssh -i B"));
    // repo đã tin cậy thì không bao giờ quét lại (không có ghi đè nào để làm mới)
    assert_eq!(fx.core.trust_repo(&opened.repo_id).await.unwrap().trust, "trusted");
    let trusted = fx.core.registry.get(&opened.repo_id).unwrap();
    std::fs::write(fx.repo.home().join(".gitconfig"), "[core]\n\tsshCommand = ssh -i C\n").unwrap();
    assert!(Arc::ptr_eq(&trusted, &fx.core.fresh_entry(trusted.clone()).await.unwrap()));
}

#[tokio::test]
async fn sequence_editor_and_trailer_commands_of_an_untrusted_repo_never_run() {
    // `sequence.editor` thắng `GIT_EDITOR=true` nên không thể dựa vào biến môi trường; `trailer.<token>.cmd` chạy khi `commit --trailer`.
    let fx = Fx::new().await;
    fx.repo.write("b.txt", "b\n");
    fx.repo.commit_all("second");
    let editor = fx.script("seq-editor", "exit 0");
    fx.config("sequence.editor", &format!("sh {}", editor.display()));
    let trailer = fx.script("trailer", "echo từ-repo");
    fx.config("trailer.sign.cmd", &trailer.to_string_lossy());
    let opened = fx.open().await;
    assert_eq!(opened.trust, "unknown");
    for expected in ["sequence.editor", "trailer.sign.cmd"] {
        assert!(opened.findings.iter().any(|f| f.starts_with(expected)), "thiếu phát hiện {expected}: {:?}", opened.findings);
    }
    let out = fx.exec(&opened, "r1", ExecKind::Write, "rebase", &["-i", "HEAD~1"]).await;
    assert_eq!(out.exit.unwrap().code, 0, "{}", out.stderr_text());
    assert!(!fx.ran("seq-editor"), "sequence.editor của repo lạ không được chạy");
    let out = fx.exec(&opened, "c1", ExecKind::Write, "commit", &["--allow-empty", "-m", "m", "--trailer", "sign=abc"]).await;
    assert_eq!(out.exit.unwrap().code, 0, "{}", out.stderr_text());
    assert!(!fx.ran("trailer"), "trailer.<token>.cmd của repo lạ không được chạy");
    // đối chứng: git trần chạy cả hai
    let _ = fx.repo.git_raw(&["rebase", "-i", "HEAD~1"]);
    assert!(fx.ran("seq-editor"), "đối chứng: git trần chạy sequence.editor");
    let _ = fx.repo.git_raw(&["commit", "--allow-empty", "-m", "m2", "--trailer", "sign=abc"]);
    assert!(fx.ran("trailer"), "đối chứng: git trần chạy trailer.<token>.cmd");
}

#[tokio::test]
async fn trust_only_covers_the_findings_the_user_was_shown() {
    let fx = Fx::new().await;
    let marker = evil_branch_fixture(&fx, "seed.inc");
    fx.config("include.path", "../seed.inc");
    let opened = fx.open().await;
    assert!(opened.findings.iter().all(|f| !f.starts_with("filter.")), "{:?}", opened.findings);
    // Chuyển nhánh ngoài app rồi một lệnh đọc: entry được quét lại và đã có `filter.evil.clean`, nhưng người dùng chưa thấy.
    fx.repo.git(&["checkout", "-q", "evil"]);
    fx.exec(&opened, "r1", ExecKind::Read, "log", &["-1", "--format=%H"]).await;
    assert!(fx.core.registry.get(&opened.repo_id).unwrap().findings.iter().any(|f| f.display.starts_with("filter.evil.clean")));
    // Bấm "Tin tưởng" theo danh sách CŨ → không có hiệu lực với phần mới; trả lại danh sách mới để xem.
    let after = fx.core.trust_repo(&opened.repo_id).await.unwrap();
    assert_eq!(after.trust, "unknown", "tập khoá đã đổi so với bản đã hiển thị: phải hỏi lại");
    assert!(after.findings.iter().any(|f| f.starts_with("filter.evil.clean")), "{:?}", after.findings);
    fx.repo.write("payload.x", "dữ liệu\n");
    let (result, _) = run(&fx.core, "main", request(&opened.repo_id, "a1", ExecKind::Write, "add", &["--", "payload.x"])).await;
    assert_eq!(result.unwrap_err().code(), "untrusted");
    assert!(!fx.ran(marker));
    // Bấm lần hai (đã thấy danh sách có `filter.evil.clean`) mới tin tưởng.
    let after = fx.core.trust_repo(&opened.repo_id).await.unwrap();
    assert_eq!(after.trust, "trusted");
    // Quyết định gắn với tập khoá: mở lại vẫn tin cậy khi tập không đổi.
    assert_eq!(open(&fx.core, &fx.repo).await.trust, "trusted");
}
