//! Untrusted repos (the trust gate): scan the config and hooks that can run commands, restricted mode, and storing the
//! trust decision.
//!
//! `open_repo` runs `git config --list --show-scope --show-origin -z` (with hard-coded `-c` flags already attached), filters
//! entries in the `local`/`worktree` scopes (including `include` files) that match a command-running key, plus hooks that
//! are not `.sample`. Nothing found → open normally. Something found → `unknown` until the user trusts. Not trusted means
//! restricted mode: Rust resets `core.hooksPath` to the app's empty directory and overrides every key found with the
//! global/system value or a neutralising value (via `GIT_CONFIG_COUNT/KEY_n/VALUE_n` — no `=` quoting games like `-c`), and
//! disables autofetch.
//!
//! The overrides are built from the scan at open time, so they can ALREADY BE STALE when the effective config changes while
//! `.git/config` does not (an `include` of a tracked file that changes per branch, `includeIf onbranch:`). Two layers guard
//! against that: (1) a fingerprint (`registry::ConfigFingerprint`) of every `file:` source of the scan + include targets +
//! HEAD — a change triggers a rescan before the next command; (2) a repo with `include*` (or an untrackable config source) is
//! `fail_closed`: only purely read-only commands (`GitPolicy::is_exec_free`) run until the user trusts. gpg programs (whose
//! keys are fixed) are always pinned, without waiting for a scan to find them.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::errors::{AppError, Result};
use crate::store;

/// One line of `git config --list --show-scope --show-origin -z`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigEntry {
    pub scope: String,
    pub origin: String,
    /// The key as git printed it: section/variable lowercased, subsection kept as-is.
    pub key: String,
    pub value: String,
}

impl ConfigEntry {
    /// Controlled by the repo (the `.git/config` file, `config.worktree`, and files included from them).
    pub fn repo_controlled(&self) -> bool {
        self.scope == "local" || self.scope == "worktree"
    }

    /// Controlled by the user / the system (the `command` scope is the app's own `-c` flags, so it is ignored).
    pub fn user_controlled(&self) -> bool {
        matches!(self.scope.as_str(), "system" | "global" | "unknown")
    }
}

/// Parse the `-z` output: each entry is `scope NUL origin NUL key NEWLINE value NUL` (a key with no value: `key NUL`).
pub fn parse_config_list(bytes: &[u8]) -> Vec<ConfigEntry> {
    let mut tokens: Vec<&[u8]> = bytes.split(|b| *b == 0).collect();
    if tokens.last().is_some_and(|t| t.is_empty()) {
        tokens.pop();
    }
    let (chunks, _) = tokens.as_chunks::<3>();
    chunks
        .iter()
        .map(|chunk| {
            let (key, value) = match chunk[2].iter().position(|b| *b == b'\n') {
                Some(index) => (&chunk[2][..index], &chunk[2][index + 1..]),
                None => (chunk[2], &b""[..]),
            };
            ConfigEntry {
                scope: String::from_utf8_lossy(chunk[0]).into_owned(),
                origin: String::from_utf8_lossy(chunk[1]).into_owned(),
                key: String::from_utf8_lossy(key).into_owned(),
                value: String::from_utf8_lossy(value).into_owned(),
            }
        })
        .collect()
}

/// A group of keys that can run commands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum KeyKind {
    Fsmonitor,
    HooksPath,
    SshCommand,
    AskPass,
    GitProxy,
    Editor,
    Pager,
    Worktree,
    Filter,
    DiffDriver,
    DiffExternal,
    MergeDriver,
    CredentialHelper,
    GpgProgram,
    RemoteUploadPack,
    RemoteReceivePack,
    RemoteVcs,
    ProtocolAllow,
    UrlRewrite,
    Include,
    /// `sequence.editor` (`rebase -i`): beats `GIT_EDITOR`, so it cannot be handled by `GIT_EDITOR=true` alone.
    SequenceEditor,
    /// `trailer.<token>.cmd|command` (`commit --trailer`, `interpret-trailers`).
    TrailerCommand,
    /// `core.alternateRefsCommand` (fetch/push when the repo has alternates).
    AlternateRefsCommand,
    /// `gpg.ssh.defaultKeyCommand` (signing with ssh when no key is chosen).
    SshDefaultKeyCommand,
    /// `submodule.<name>.update = !command` (`pull --recurse-submodules` → `submodule update`).
    SubmoduleUpdate,
    /// `lfs.customtransfer.<name>.path`, `lfs.extension.<name>.clean|smudge`: git-lfs (the user's `filter.lfs` filter, the
    /// `git lfs …` commands) runs this program. A `.lfsconfig` in the repo cannot make git-lfs read these keys.
    LfsProgram,
}

static KEY_PATTERNS: LazyLock<Vec<(Regex, KeyKind)>> = LazyLock::new(|| {
    let table: &[(&str, KeyKind)] = &[
        (r"^core\.fsmonitor$", KeyKind::Fsmonitor),
        (r"^core\.hookspath$", KeyKind::HooksPath),
        (r"^core\.sshcommand$", KeyKind::SshCommand),
        (r"^core\.askpass$", KeyKind::AskPass),
        (r"^core\.gitproxy$", KeyKind::GitProxy),
        (r"^core\.editor$", KeyKind::Editor),
        (r"^core\.pager$", KeyKind::Pager),
        (r"^core\.worktree$", KeyKind::Worktree),
        (r"^filter\..+\.(clean|smudge|process)$", KeyKind::Filter),
        (r"^diff\..+\.(textconv|command)$", KeyKind::DiffDriver),
        (r"^diff\.external$", KeyKind::DiffExternal),
        (r"^merge\..+\.driver$", KeyKind::MergeDriver),
        (r"^credential\.(.+\.)?helper$", KeyKind::CredentialHelper),
        (r"^gpg\.(.+\.)?program$", KeyKind::GpgProgram),
        (r"^remote\..+\.uploadpack$", KeyKind::RemoteUploadPack),
        (r"^remote\..+\.receivepack$", KeyKind::RemoteReceivePack),
        (r"^remote\..+\.vcs$", KeyKind::RemoteVcs),
        (r"^protocol\.(.+\.)?allow$", KeyKind::ProtocolAllow),
        (r"^url\..+\.(pushinsteadof|insteadof)$", KeyKind::UrlRewrite),
        (r"^include\.path$", KeyKind::Include),
        (r"^includeif\..+\.path$", KeyKind::Include),
        (r"^sequence\.editor$", KeyKind::SequenceEditor),
        (r"^trailer\..+\.(cmd|command)$", KeyKind::TrailerCommand),
        (r"^core\.alternaterefscommand$", KeyKind::AlternateRefsCommand),
        (r"^gpg\.ssh\.defaultkeycommand$", KeyKind::SshDefaultKeyCommand),
        (r"^submodule\..+\.update$", KeyKind::SubmoduleUpdate),
        // git lowercases only the section and key names; the middle part (`[lfs "customTransfer.x"]`) keeps its case, while git-lfs compares it case-insensitively.
        (r"(?i)^lfs\.customtransfer\..+\.path$", KeyKind::LfsProgram),
        (r"(?i)^lfs\.extension\..+\.(clean|smudge)$", KeyKind::LfsProgram),
    ];
    table.iter().map(|(pattern, kind)| (Regex::new(pattern).expect("regex khoá hợp lệ"), *kind)).collect()
});

pub fn classify_key(key: &str) -> Option<KeyKind> {
    KEY_PATTERNS.iter().find(|(pattern, _)| pattern.is_match(key)).map(|(_, kind)| *kind)
}

/// A hook file in `<commonDir>/hooks` that is not `.sample`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookFile {
    pub name: String,
    pub digest: String,
}

pub fn read_hooks(common_dir: &Path) -> Vec<HookFile> {
    let Ok(entries) = std::fs::read_dir(common_dir.join("hooks")) else {
        return Vec::new();
    };
    let mut hooks: Vec<HookFile> = entries
        .filter_map(|e| e.ok())
        .filter(|e| !e.file_name().to_string_lossy().ends_with(".sample"))
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file() || t.is_symlink()))
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let bytes = std::fs::metadata(e.path()).ok().filter(|m| m.len() <= 1024 * 1024).and_then(|_| std::fs::read(e.path()).ok());
            if bytes.as_deref().is_some_and(|bytes| is_git_lfs_hook(&name, bytes)) {
                return None;
            }
            let digest = bytes.map(|bytes| hex(&Sha256::digest(&bytes))).unwrap_or_else(|| "không-đọc-được".to_string());
            Some(HookFile { name, digest })
        })
        .collect();
    hooks.sort_by(|a, b| a.name.cmp(&b.name));
    hooks
}

/// The standard hooks git-lfs installs (`git lfs install`, `git lfs track`…): they only call `git lfs <hook name> "$@"`, i.e. the
/// user's git-lfs program acting as the `filter.lfs` filter — not a repo hook. Match the git-lfs template VERBATIM (both the
/// old `echo` and the new `printf` version); its quoted error message may not contain `"`, `$`, a backtick or `\` (except
/// `\n`), so no command can be injected.
fn is_git_lfs_hook(name: &str, bytes: &[u8]) -> bool {
    static TEMPLATE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(concat!(
            r#"\A#!/bin/sh\r?\n"#,
            r#"command -v git-lfs >/dev/null 2>&1 \|\| \{ (?:echo >&2 |printf >&2 "\\n%s\\n\\n" )"(?:[^"$`\\\r\n]|\\n)*"; exit 2; \}\r?\n"#,
            r#"git lfs (pre-push|post-checkout|post-commit|post-merge) "\$@"(?:\r?\n)?\z"#,
        ))
        .expect("regex hook git-lfs hợp lệ")
    });
    let Ok(text) = std::str::from_utf8(bytes) else { return false };
    TEMPLATE.captures(text).is_some_and(|caps| &caps[1] == name)
}

pub fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut out, b| {
        let _ = write!(out, "{b:02x}");
        out
    })
}

/// Suspicious keys / hooks found (shown to the user in the trust prompt).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    pub label: String,
    pub kind: Option<KeyKind>,
    /// The line shown in the dialog: `core.fsmonitor = /x/cmd  (local, file:.git/config)`.
    pub display: String,
}

const MAX_DISPLAY_VALUE: usize = 160;

fn truncate(text: &str) -> String {
    if text.chars().count() <= MAX_DISPLAY_VALUE {
        text.to_string()
    } else {
        format!("{}…", text.chars().take(MAX_DISPLAY_VALUE).collect::<String>())
    }
}

/// Repo-controlled config entries matching a command-running key, plus hooks. When two display lines are identical only the
/// first occurrence is kept: a multi-valued key, or the same value in several include files, produces identical lines, and the UI
/// uses that line as a list key.
pub fn find_findings(entries: &[ConfigEntry], hooks: &[HookFile]) -> Vec<Finding> {
    let mut findings: Vec<Finding> = entries
        .iter()
        .filter(|e| e.repo_controlled())
        .filter_map(|e| {
            let kind = classify_key(&e.key)?;
            Some(Finding {
                label: e.key.clone(),
                kind: Some(kind),
                display: format!("{} = {}  ({}, {})", e.key, truncate(&e.value), e.scope, e.origin),
            })
        })
        .collect();
    findings.extend(hooks.iter().map(|h| Finding {
        label: format!("hook:{}", h.name),
        kind: None,
        display: format!("hook: {}", h.name),
    }));
    let mut seen: BTreeSet<String> = BTreeSet::new();
    findings.retain(|finding| seen.insert(finding.display.clone()));
    findings
}

/// Hash of the command-running key set + hooks (a changed set → ask about trust again).
pub fn findings_hash(entries: &[ConfigEntry], hooks: &[HookFile]) -> String {
    let mut lines: BTreeSet<String> = entries
        .iter()
        .filter(|e| e.repo_controlled() && classify_key(&e.key).is_some())
        .map(|e| format!("cfg\t{}\t{}\t{}", e.scope, e.key, e.value))
        .collect();
    lines.extend(hooks.iter().map(|h| format!("hook\t{}\t{}", h.name, h.digest)));
    let mut hasher = Sha256::new();
    for line in &lines {
        hasher.update(line.as_bytes());
        hasher.update(b"\n");
    }
    hex(&hasher.finalize())
}

/// The restricted-mode overrides.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Restrictions {
    /// `(key, value)` set through `GIT_CONFIG_*` (`command` scope, which beats the repo's config).
    pub config: Vec<(String, String)>,
    /// `GIT_PROXY_COMMAND` (git only looks at the FIRST config value of `core.gitproxy`, so an env var is required).
    pub proxy_command: Option<String>,
    /// Keys that cannot be neutralised by an override (`url.*.insteadOf` changes the destination, `include*` pulls in more files
    /// later, `remote.*.uploadpack/receivepack` where git accepts only the first value): network operations are blocked until the user trusts.
    pub blocks_network: bool,
    /// Config whose effect can change in ways we cannot reliably track: `include`/`includeIf` pointing at another file (including an
    /// ALREADY TRACKED file whose content changes on a branch switch, or `includeIf onbranch:` toggling per branch), or a source that is not a file.
    /// Since overrides built from the scan may already be stale, every command that could run something from the config (filters,
    /// textconv, merge driver…) is blocked until the user trusts; only purely read-only commands (`GitPolicy::is_exec_free`) remain. Always implies `blocks_network`.
    pub fail_closed: bool,
}

impl Restrictions {
    /// Env for the git process: `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_i`, `GIT_CONFIG_VALUE_i`, `GIT_PROXY_COMMAND`.
    pub fn env(&self) -> Vec<(String, String)> {
        let mut env = vec![("GIT_CONFIG_COUNT".to_string(), self.config.len().to_string())];
        for (index, (key, value)) in self.config.iter().enumerate() {
            env.push((format!("GIT_CONFIG_KEY_{index}"), key.clone()));
            env.push((format!("GIT_CONFIG_VALUE_{index}"), value.clone()));
        }
        if let Some(command) = &self.proxy_command {
            env.push(("GIT_PROXY_COMMAND".to_string(), command.clone()));
        }
        env
    }
}

fn last_trusted<'a>(entries: &'a [ConfigEntry], key: &str) -> Option<&'a str> {
    entries.iter().rev().find(|e| e.user_controlled() && e.key == key).map(|e| e.value.as_str())
}

/// Signing / signature-verification programs: their keys are fixed, so they are always pinned to the user's (or the default) value,
/// even when the scan does not find them (e.g. they live in an `include` file that changes per branch). `log --format=%G?` / `%(signature)` runs them.
const GPG_PINNED: [(&[&str], &str); 3] =
    [(&["gpg.program", "gpg.openpgp.program"], "gpg"), (&["gpg.x509.program"], "gpgsm"), (&["gpg.ssh.program"], "ssh-keygen")];

fn last_trusted_of<'a>(entries: &'a [ConfigEntry], keys: &[&str]) -> Option<&'a str> {
    entries.iter().rev().find(|e| e.user_controlled() && keys.contains(&e.key.as_str())).map(|e| e.value.as_str())
}

/// Build the overrides for an untrusted repo. `empty_hooks` is the app's empty directory (always set as `core.hooksPath`).
pub fn build_restrictions(entries: &[ConfigEntry], empty_hooks: &Path) -> Restrictions {
    let mut restrictions = Restrictions::default();
    restrictions.config.push(("core.hooksPath".to_string(), empty_hooks.to_string_lossy().into_owned()));

    let mut handled: BTreeSet<String> = BTreeSet::new();
    for (keys, default) in GPG_PINNED {
        // `gpg.program` and `gpg.openpgp.program` are the same variable in git: pin both to the same value.
        let value = last_trusted_of(entries, keys).unwrap_or(default);
        for key in keys {
            handled.insert((*key).to_string());
            restrictions.config.push(((*key).to_string(), value.to_string()));
        }
    }
    let mut credential_reset_added = false;
    for entry in entries.iter().filter(|e| e.repo_controlled()) {
        // A source that is not a file (blob/stdin/…) leaves nothing whose changes could be tracked.
        if !entry.origin.starts_with("file:") {
            restrictions.fail_closed = true;
        }
        let Some(kind) = classify_key(&entry.key) else { continue };
        if kind == KeyKind::Include {
            restrictions.fail_closed = true;
        }
        if !handled.insert(entry.key.clone()) {
            continue;
        }
        let trusted = last_trusted(entries, &entry.key);
        let key = entry.key.clone();
        let neutral = |fallback: &str| trusted.unwrap_or(fallback).to_string();
        match kind {
            // `-c core.fsmonitor=false` / `core.pager=cat` / GIT_EDITOR=true are always present; hooksPath was set above.
            KeyKind::Fsmonitor | KeyKind::HooksPath | KeyKind::Editor | KeyKind::Pager | KeyKind::Worktree => {}
            KeyKind::SshCommand => restrictions.config.push((key, neutral("ssh"))),
            KeyKind::AskPass => restrictions.config.push((key, neutral(""))),
            KeyKind::GitProxy => {
                let value = trusted.filter(|v| !v.contains(" for ")).unwrap_or("");
                restrictions.proxy_command = Some(value.to_string());
            }
            KeyKind::Filter | KeyKind::DiffDriver | KeyKind::DiffExternal | KeyKind::LfsProgram => {
                restrictions.config.push((key, neutral("")))
            }
            // An empty driver would "succeed" without merging anything; `false` forces a conflict report (the safe outcome).
            KeyKind::MergeDriver => restrictions.config.push((key, neutral("false"))),
            KeyKind::CredentialHelper => {
                // An empty value clears the whole loaded helper list; then the user's / system's helpers are added back
                // (keeping their keys, including `credential.<url>.helper`).
                if !credential_reset_added {
                    credential_reset_added = true;
                    restrictions.config.push(("credential.helper".to_string(), String::new()));
                    for trusted_entry in entries.iter().filter(|e| e.user_controlled() && classify_key(&e.key) == Some(KeyKind::CredentialHelper)) {
                        restrictions.config.push((trusted_entry.key.clone(), trusted_entry.value.clone()));
                    }
                }
            }
            KeyKind::GpgProgram => {
                // The fixed keys were pinned above; what remains is `gpg.<unusual format>.program`.
                let default = if key.contains(".ssh.") {
                    "ssh-keygen"
                } else if key.contains(".x509.") {
                    "gpgsm"
                } else {
                    "gpg"
                };
                restrictions.config.push((key, neutral(default)));
            }
            // git accepts only the FIRST value of `remote.<name>.uploadpack/receivepack`, so `command`-scope config cannot
            // override it: treat it as not neutralisable and block network commands until the user trusts.
            KeyKind::RemoteUploadPack | KeyKind::RemoteReceivePack | KeyKind::UrlRewrite | KeyKind::Include => {
                restrictions.blocks_network = true;
            }
            KeyKind::RemoteVcs => restrictions.config.push((key, neutral(""))),
            // `true`/`false` are standard programs that do nothing (keep the todo list / report an error instead of running a repo command).
            KeyKind::SequenceEditor | KeyKind::AlternateRefsCommand => restrictions.config.push((key, neutral("true"))),
            KeyKind::TrailerCommand | KeyKind::SshDefaultKeyCommand => restrictions.config.push((key, neutral("false"))),
            KeyKind::SubmoduleUpdate => restrictions.config.push((key, neutral("checkout"))),
            KeyKind::ProtocolAllow => {
                let default = if key == "protocol.ext.allow" { "never" } else { "user" };
                restrictions.config.push((key, neutral(default)));
            }
        }
    }
    if restrictions.fail_closed {
        restrictions.blocks_network = true;
    }
    restrictions
}

/// Every config file the scan read (`file:` origin) plus the target of every `include`/`includeIf` key — including files that did NOT
/// exist at scan time (git skips a missing file, but it can appear later, e.g. through a branch switch). Relative paths resolve from the scan's `cwd`.
pub fn config_files(entries: &[ConfigEntry], cwd: &Path) -> Vec<PathBuf> {
    let resolve = |text: &str| {
        let path = Path::new(text);
        if path.is_absolute() { path.to_path_buf() } else { cwd.join(path) }
    };
    let mut files: BTreeSet<PathBuf> = BTreeSet::new();
    for entry in entries {
        let Some(origin) = entry.origin.strip_prefix("file:") else { continue };
        let origin = resolve(origin);
        if classify_key(&entry.key) == Some(KeyKind::Include)
            && let Some(target) = include_target(&entry.value, origin.parent())
        {
            files.insert(target);
        }
        files.insert(origin);
    }
    files.into_iter().collect()
}

/// The target of `include.path`: `~/…` from the home directory, absolute paths unchanged, relative paths from the directory of the file containing the include line.
fn include_target(value: &str, base: Option<&Path>) -> Option<PathBuf> {
    if let Some(rest) = value.strip_prefix("~/") {
        let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
        return Some(PathBuf::from(home).join(rest));
    }
    let path = Path::new(value);
    if path.is_absolute() { Some(path.to_path_buf()) } else { base.map(|dir| dir.join(path)) }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct TrustFile {
    #[serde(default)]
    entries: BTreeMap<String, String>,
}

/// The stored trust decision: `real path → hash of the command-running key set`.
pub struct TrustStore {
    path: PathBuf,
    entries: Mutex<BTreeMap<String, String>>,
}

impl TrustStore {
    pub fn new(data_dir: &Path) -> Self {
        let path = data_dir.join("trust.json");
        let entries = store::read_json::<TrustFile>(&path).map(|f| f.entries).unwrap_or_default();
        Self { path, entries: Mutex::new(entries) }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, BTreeMap<String, String>> {
        self.entries.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn is_trusted(&self, path_key: &str, hash: &str) -> bool {
        self.lock().get(path_key).is_some_and(|stored| stored == hash)
    }

    pub fn trust(&self, path_key: &str, hash: &str) -> Result<()> {
        let snapshot = {
            let mut entries = self.lock();
            entries.insert(path_key.to_string(), hash.to_string());
            TrustFile { entries: entries.clone() }
        };
        store::write_json(&self.path, &snapshot).map_err(|e| AppError::Io(format!("Không lưu được quyết định tin cậy: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(scope: &str, key: &str, value: &str) -> ConfigEntry {
        ConfigEntry { scope: scope.into(), origin: "file:.git/config".into(), key: key.into(), value: value.into() }
    }

    #[test]
    fn parses_the_z_format_with_multiline_and_missing_values() {
        let raw = b"system\0file:/etc/gitconfig\0credential.helper\nosxkeychain\0local\0file:.git/config\0core.bare\0local\0file:.git/config\0alias.x\nlog\n--oneline\0";
        let entries = parse_config_list(raw);
        assert_eq!(entries.len(), 3);
        assert_eq!((entries[0].scope.as_str(), entries[0].key.as_str(), entries[0].value.as_str()), ("system", "credential.helper", "osxkeychain"));
        assert_eq!((entries[1].key.as_str(), entries[1].value.as_str()), ("core.bare", ""));
        assert_eq!(entries[2].value, "log\n--oneline");
        assert!(parse_config_list(b"").is_empty());
    }

    #[test]
    fn classifies_every_command_running_key_from_the_plan() {
        let hits = [
            ("core.fsmonitor", KeyKind::Fsmonitor),
            ("core.hookspath", KeyKind::HooksPath),
            ("core.sshcommand", KeyKind::SshCommand),
            ("core.askpass", KeyKind::AskPass),
            ("core.gitproxy", KeyKind::GitProxy),
            ("core.editor", KeyKind::Editor),
            ("core.pager", KeyKind::Pager),
            ("filter.lfs.clean", KeyKind::Filter),
            ("filter.lfs.smudge", KeyKind::Filter),
            ("filter.lfs.process", KeyKind::Filter),
            ("filter.a b.clean", KeyKind::Filter),
            ("diff.word.textconv", KeyKind::DiffDriver),
            ("diff.x.command", KeyKind::DiffDriver),
            ("diff.external", KeyKind::DiffExternal),
            ("merge.union.driver", KeyKind::MergeDriver),
            ("credential.helper", KeyKind::CredentialHelper),
            ("credential.https://github.com.helper", KeyKind::CredentialHelper),
            ("gpg.program", KeyKind::GpgProgram),
            ("gpg.ssh.program", KeyKind::GpgProgram),
            ("remote.origin.uploadpack", KeyKind::RemoteUploadPack),
            ("remote.origin.receivepack", KeyKind::RemoteReceivePack),
            ("remote.origin.vcs", KeyKind::RemoteVcs),
            ("protocol.ext.allow", KeyKind::ProtocolAllow),
            ("protocol.allow", KeyKind::ProtocolAllow),
            ("url.git@github.com:.insteadof", KeyKind::UrlRewrite),
            ("include.path", KeyKind::Include),
            ("includeif.gitdir:/x/.path", KeyKind::Include),
            ("sequence.editor", KeyKind::SequenceEditor),
            ("trailer.sign.cmd", KeyKind::TrailerCommand),
            ("trailer.sign.command", KeyKind::TrailerCommand),
            ("core.alternaterefscommand", KeyKind::AlternateRefsCommand),
            ("gpg.ssh.defaultkeycommand", KeyKind::SshDefaultKeyCommand),
            ("submodule.libs/x.update", KeyKind::SubmoduleUpdate),
            ("lfs.customtransfer.x.path", KeyKind::LfsProgram),
            ("lfs.extension.foo.clean", KeyKind::LfsProgram),
            ("lfs.extension.foo.smudge", KeyKind::LfsProgram),
            ("lfs.CustomTransfer.x.path", KeyKind::LfsProgram),
        ];
        for (key, kind) in hits {
            assert_eq!(classify_key(key), Some(kind), "{key}");
        }
        for key in [
            "user.name", "core.autocrlf", "remote.origin.url", "branch.main.remote", "core.filemode", "alias.co", "filter.lfs.required",
            "sequence.replaceeditor", "trailer.sign.key", "submodule.x.url", "submodule.recurse", "core.alternaterefsprefixes",
            "lfs.url", "lfs.customtransfer.x.args", "lfs.extension.foo.priority",
        ] {
            assert_eq!(classify_key(key), None, "{key}");
        }
    }

    #[test]
    fn findings_only_count_repo_controlled_entries_and_non_sample_hooks() {
        let entries = vec![
            entry("global", "core.sshcommand", "ssh -i mine"),
            entry("local", "core.fsmonitor", "touch /tmp/pwned"),
            entry("local", "core.filemode", "true"),
            entry("worktree", "filter.x.clean", "evil"),
            entry("command", "core.fsmonitor", "false"),
        ];
        let hooks = vec![HookFile { name: "pre-commit".into(), digest: "ab".into() }];
        let findings = find_findings(&entries, &hooks);
        let labels: Vec<_> = findings.iter().map(|f| f.label.as_str()).collect();
        assert_eq!(labels, ["core.fsmonitor", "filter.x.clean", "hook:pre-commit"]);
        assert!(findings[0].display.contains("touch /tmp/pwned"));
        assert!(find_findings(&[entry("global", "core.fsmonitor", "x")], &[]).is_empty());
    }

    #[test]
    fn findings_are_deduplicated_keeping_first_appearance_order() {
        // A multi-valued key (`core.fsmonitor` set twice identically, or the same value in two include files) produces one identical display line:
        // the UI uses that line as the `{#each}` key, so a duplicate would break the whole trust dialog.
        let entries = vec![
            entry("local", "core.fsmonitor", "touch /tmp/pwned"),
            entry("local", "filter.x.clean", "evil"),
            entry("local", "core.fsmonitor", "touch /tmp/pwned"),
            entry("worktree", "core.fsmonitor", "touch /tmp/pwned"),
            entry("local", "filter.x.clean", "evil"),
        ];
        let hooks = vec![HookFile { name: "pre-commit".into(), digest: "a".into() }, HookFile { name: "pre-commit".into(), digest: "b".into() }];
        let findings = find_findings(&entries, &hooks);
        let shown: Vec<_> = findings.iter().map(|f| f.display.as_str()).collect();
        assert_eq!(
            shown,
            [
                "core.fsmonitor = touch /tmp/pwned  (local, file:.git/config)",
                "filter.x.clean = evil  (local, file:.git/config)",
                "core.fsmonitor = touch /tmp/pwned  (worktree, file:.git/config)",
                "hook: pre-commit",
            ]
        );
        let unique: BTreeSet<_> = shown.iter().collect();
        assert_eq!(unique.len(), shown.len());
    }

    #[test]
    fn findings_hash_changes_with_values_and_hooks_but_not_order() {
        let a = vec![entry("local", "core.fsmonitor", "one"), entry("local", "core.sshcommand", "two")];
        let b = vec![entry("local", "core.sshcommand", "two"), entry("local", "core.fsmonitor", "one")];
        let hook = HookFile { name: "pre-commit".into(), digest: "d1".into() };
        assert_eq!(findings_hash(&a, &[]), findings_hash(&b, &[]));
        assert_ne!(findings_hash(&a, &[]), findings_hash(&a, std::slice::from_ref(&hook)));
        let changed = vec![entry("local", "core.fsmonitor", "other"), entry("local", "core.sshcommand", "two")];
        assert_ne!(findings_hash(&a, &[]), findings_hash(&changed, &[]));
        let edited = HookFile { name: "pre-commit".into(), digest: "d2".into() };
        assert_ne!(findings_hash(&a, std::slice::from_ref(&hook)), findings_hash(&a, &[edited]));
        // An unrelated entry (set by the user) has no effect.
        let mut with_noise = a.clone();
        with_noise.push(entry("local", "user.name", "x"));
        assert_eq!(findings_hash(&a, &[]), findings_hash(&with_noise, &[]));
    }

    #[test]
    fn restrictions_use_trusted_values_or_neutral_ones() {
        let entries = vec![
            entry("global", "core.sshcommand", "ssh -i ~/.ssh/mine"),
            entry("system", "credential.helper", "osxkeychain"),
            entry("global", "credential.https://github.com.helper", "!gh auth git-credential"),
            entry("global", "filter.lfs.clean", "git-lfs clean -- %f"),
            entry("local", "core.sshcommand", "touch /tmp/pwned"),
            entry("local", "core.askpass", "/tmp/evil"),
            entry("local", "core.gitproxy", "/tmp/proxy"),
            entry("local", "filter.lfs.clean", "evil clean"),
            entry("local", "filter.x.smudge", "evil smudge"),
            entry("local", "filter.x.process", "evil process"),
            entry("local", "diff.x.textconv", "evil"),
            entry("local", "diff.external", "evil"),
            entry("local", "merge.m.driver", "evil %A"),
            entry("local", "credential.helper", "!evil"),
            entry("local", "credential.https://x.helper", "!evil2"),
            entry("local", "gpg.program", "evil"),
            entry("local", "gpg.ssh.program", "evil"),
            entry("local", "remote.origin.vcs", "evil"),
            entry("local", "protocol.ext.allow", "always"),
            entry("local", "protocol.fd.allow", "always"),
            entry("local", "core.fsmonitor", "evil"),
            entry("local", "sequence.editor", "evil"),
            entry("local", "trailer.sign.cmd", "evil"),
            entry("local", "core.alternaterefscommand", "evil"),
            entry("local", "gpg.ssh.defaultkeycommand", "evil"),
            entry("local", "submodule.libs.update", "!evil"),
            entry("global", "sequence.editor", "my-editor"),
        ];
        let r = build_restrictions(&entries, Path::new("/data/empty-hooks"));
        let get = |key: &str| r.config.iter().filter(|(k, _)| k == key).map(|(_, v)| v.as_str()).collect::<Vec<_>>();
        assert_eq!(get("core.hooksPath"), ["/data/empty-hooks"]);
        assert_eq!(get("core.sshcommand"), ["ssh -i ~/.ssh/mine"], "giá trị của người dùng thắng giá trị của repo");
        assert_eq!(get("core.askpass"), [""]);
        assert_eq!(r.proxy_command.as_deref(), Some(""));
        assert_eq!(get("filter.lfs.clean"), ["git-lfs clean -- %f"]);
        assert_eq!(get("filter.x.smudge"), [""]);
        assert_eq!(get("filter.x.process"), [""]);
        assert_eq!(get("diff.x.textconv"), [""]);
        assert_eq!(get("diff.external"), [""]);
        assert_eq!(get("merge.m.driver"), ["false"]);
        assert_eq!(get("gpg.program"), ["gpg"]);
        assert_eq!(get("gpg.ssh.program"), ["ssh-keygen"]);
        assert_eq!(get("remote.origin.vcs"), [""]);
        assert_eq!(get("protocol.ext.allow"), ["never"]);
        assert_eq!(get("protocol.fd.allow"), ["user"]);
        // credential.helper: reset it, then add the user's / system's helpers back in order and under the right keys.
        assert_eq!(get("credential.helper"), ["", "osxkeychain"]);
        assert_eq!(get("credential.https://github.com.helper"), ["!gh auth git-credential"]);
        assert!(get("credential.https://x.helper").is_empty());
        assert!(!r.blocks_network && !r.fail_closed);
        assert!(get("core.fsmonitor").is_empty(), "đã có -c core.fsmonitor=false");
        assert_eq!(get("sequence.editor"), ["my-editor"], "giá trị của người dùng thắng");
        assert_eq!(get("trailer.sign.cmd"), ["false"]);
        assert_eq!(get("core.alternaterefscommand"), ["true"]);
        assert_eq!(get("gpg.ssh.defaultkeycommand"), ["false"]);
        assert_eq!(get("submodule.libs.update"), ["checkout"]);
    }

    #[test]
    fn first_wins_and_unoverridable_keys_cannot_be_neutralised_so_they_block_network() {
        for key in ["url.https://evil/.insteadof", "include.path", "includeif.gitdir:/x/.path", "remote.origin.uploadpack", "remote.origin.receivepack"] {
            let r = build_restrictions(&[entry("local", key, "x")], Path::new("/h"));
            assert!(r.blocks_network, "{key}");
        }
        assert!(!build_restrictions(&[entry("global", "include.path", "x")], Path::new("/h")).blocks_network);
    }

    fn entry_at(scope: &str, origin: &str, key: &str, value: &str) -> ConfigEntry {
        ConfigEntry { scope: scope.into(), origin: origin.into(), key: key.into(), value: value.into() }
    }

    #[test]
    fn include_keys_and_untrackable_origins_make_the_repo_fail_closed() {
        let hooks = Path::new("/h");
        for key in ["include.path", "includeif.onbranch:feat.path", "includeif.gitdir:/x/.path", "includeif.hasconfig:remote.*.url:https://x/**.path"] {
            let r = build_restrictions(&[entry("local", key, "../seed.inc")], hooks);
            assert!(r.fail_closed && r.blocks_network, "{key}");
            // including an include inside the worktree config
            assert!(build_restrictions(&[entry("worktree", key, "x")], hooks).fail_closed, "{key}");
        }
        // The user's own includes (global/system) are not repo-controlled.
        assert!(!build_restrictions(&[entry("global", "include.path", "~/.gitconfig.d/work")], hooks).fail_closed);
        // A non-file source whose changes cannot be tracked.
        for origin in ["blob:0123abcd", "standard input:", "command line:"] {
            let r = build_restrictions(&[entry_at("local", origin, "core.filemode", "true")], hooks);
            assert!(r.fail_closed && r.blocks_network, "{origin}");
        }
        // Ordinary config (including a neutralisable command-running key) does not make this fail-closed.
        let plain = build_restrictions(&[entry("local", "core.sshcommand", "evil"), entry("local", "user.name", "x")], hooks);
        assert!(!plain.fail_closed && !plain.blocks_network);
    }

    #[test]
    fn gpg_programs_are_pinned_even_when_the_scan_saw_no_such_key() {
        // The key may live in an include file that changes per branch, so it cannot wait for a scan to find it.
        let r = build_restrictions(&[], Path::new("/h"));
        let get = |key: &str| r.config.iter().filter(|(k, _)| k == key).map(|(_, v)| v.as_str()).collect::<Vec<_>>();
        assert_eq!(get("gpg.program"), ["gpg"]);
        assert_eq!(get("gpg.openpgp.program"), ["gpg"]);
        assert_eq!(get("gpg.x509.program"), ["gpgsm"]);
        assert_eq!(get("gpg.ssh.program"), ["ssh-keygen"]);
        // The user's value wins; `gpg.program` and `gpg.openpgp.program` are one variable, so both get the same value.
        let r = build_restrictions(
            &[entry("global", "gpg.program", "/opt/gpg2"), entry("local", "gpg.program", "evil"), entry("local", "gpg.ssh.program", "evil")],
            Path::new("/h"),
        );
        let get = |key: &str| r.config.iter().filter(|(k, _)| k == key).map(|(_, v)| v.as_str()).collect::<Vec<_>>();
        assert_eq!(get("gpg.program"), ["/opt/gpg2"]);
        assert_eq!(get("gpg.openpgp.program"), ["/opt/gpg2"]);
        assert_eq!(get("gpg.ssh.program"), ["ssh-keygen"]);
    }

    #[cfg(unix)]
    #[test]
    fn config_files_lists_every_file_origin_and_every_include_target() {
        let entries = vec![
            entry_at("system", "file:/etc/gitconfig", "core.x", "1"),
            entry_at("global", "file:/home/u/.gitconfig", "user.name", "u"),
            entry_at("local", "file:.git/config", "include.path", "../seed.inc"),
            entry_at("local", "file:.git/../seed.inc", "x.a", "1"),
            entry_at("local", "file:.git/config", "includeif.onbranch:feat.path", "/abs/static.inc"),
            entry_at("local", "file:.git/config", "includeif.gitdir:/x/.path", "missing.inc"),
            entry_at("command", "command line:", "core.hookspath", "/e"),
            entry_at("local", "blob:abc", "core.y", "2"),
        ];
        let files = config_files(&entries, Path::new("/repo"));
        let expected: Vec<PathBuf> = [
            "/abs/static.inc",
            "/etc/gitconfig",
            "/home/u/.gitconfig",
            "/repo/.git/../seed.inc",
            "/repo/.git/config",
            "/repo/.git/missing.inc",
        ]
        .iter()
        .map(PathBuf::from)
        .collect();
        assert_eq!(files, expected, "gồm cả đích include chưa tồn tại (`missing.inc`), không gồm nguồn không phải file");
    }

    #[test]
    fn restriction_env_uses_the_unambiguous_config_env_protocol() {
        let r = Restrictions {
            config: vec![("filter.a=b.clean".into(), "".into()), ("core.hooksPath".into(), "/h".into())],
            proxy_command: Some(String::new()),
            ..Restrictions::default()
        };
        let env: BTreeMap<_, _> = r.env().into_iter().collect();
        assert_eq!(env["GIT_CONFIG_COUNT"], "2");
        assert_eq!(env["GIT_CONFIG_KEY_0"], "filter.a=b.clean");
        assert_eq!(env["GIT_CONFIG_VALUE_0"], "");
        assert_eq!(env["GIT_CONFIG_KEY_1"], "core.hooksPath");
        assert_eq!(env["GIT_PROXY_COMMAND"], "");
    }

    #[test]
    fn finds_non_sample_hooks_only() {
        let dir = tempfile::tempdir().unwrap();
        let hooks = dir.path().join("hooks");
        std::fs::create_dir(&hooks).unwrap();
        std::fs::write(hooks.join("pre-commit.sample"), b"#!/bin/sh\n").unwrap();
        std::fs::write(hooks.join("pre-commit"), b"#!/bin/sh\necho hi\n").unwrap();
        std::fs::create_dir(hooks.join("nested")).unwrap();
        let found = read_hooks(dir.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "pre-commit");
        std::fs::write(hooks.join("pre-commit"), b"#!/bin/sh\necho changed\n").unwrap();
        assert_ne!(read_hooks(dir.path())[0].digest, found[0].digest);
        assert!(read_hooks(&dir.path().join("none")).is_empty());
    }

    #[test]
    fn standard_git_lfs_hooks_are_not_findings_but_anything_else_is() {
        let message = "This repository is configured for Git LFS but 'git-lfs' was not found on your path. If you no longer wish to use Git LFS, remove this hook by deleting the 'pre-push' file in the hooks directory (set by 'core.hookspath'; usually '.git/hooks').";
        let echo = format!("#!/bin/sh\ncommand -v git-lfs >/dev/null 2>&1 || {{ echo >&2 \"\\n{message}\\n\"; exit 2; }}\ngit lfs pre-push \"$@\"\n");
        let printf = format!("#!/bin/sh\r\ncommand -v git-lfs >/dev/null 2>&1 || {{ printf >&2 \"\\n%s\\n\\n\" \"{message}\"; exit 2; }}\r\ngit lfs pre-push \"$@\"\r\n");
        assert!(is_git_lfs_hook("pre-push", echo.as_bytes()));
        assert!(is_git_lfs_hook("pre-push", printf.as_bytes()));
        // A wrong hook name, an appended command, or a `$(…)` / backtick / quote inside the error message → it is a custom hook.
        assert!(!is_git_lfs_hook("post-merge", echo.as_bytes()));
        assert!(!is_git_lfs_hook("pre-push", format!("{echo}touch /tmp/pwned\n").as_bytes()));
        for bad in ["$(touch /tmp/pwned)", "`id`", "\"; id; echo \"", "\\\"; id #"] {
            let hook = echo.replace("Git LFS but", &format!("Git LFS {bad} but"));
            assert!(!is_git_lfs_hook("pre-push", hook.as_bytes()), "{bad}");
        }

        let dir = tempfile::tempdir().unwrap();
        let hooks = dir.path().join("hooks");
        std::fs::create_dir(&hooks).unwrap();
        std::fs::write(hooks.join("pre-push"), &echo).unwrap();
        std::fs::write(hooks.join("post-merge"), &echo).unwrap();
        let names: Vec<String> = read_hooks(dir.path()).into_iter().map(|h| h.name).collect();
        assert_eq!(names, ["post-merge"]);
    }

    #[test]
    fn trust_store_persists_and_requires_the_same_hash() {
        let dir = tempfile::tempdir().unwrap();
        let store = TrustStore::new(dir.path());
        assert!(!store.is_trusted("/repo", "h1"));
        store.trust("/repo", "h1").unwrap();
        assert!(store.is_trusted("/repo", "h1"));
        assert!(!store.is_trusted("/repo", "h2"), "tập khoá đổi → hỏi lại");
        assert!(!store.is_trusted("/other", "h1"));
        let reloaded = TrustStore::new(dir.path());
        assert!(reloaded.is_trusted("/repo", "h1"));
    }
}
