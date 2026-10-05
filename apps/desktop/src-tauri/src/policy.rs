//! The git run policy: loads `packages/contracts/git-policy.json`, validates commands, and builds env and argv.
//!
//! The Rust counterpart of `packages/contracts/src/policy.ts`: it must produce identical results on every case in
//! `git-policy.vectors.json` (the `vectors_match_reference` test runs them all). The webview is NOT trusted, so the `-c`
//! flags, the env and this checker live only in Rust; the frontend sends just `sub` + `args` (plus a few allowed env vars).

use std::collections::{BTreeMap, HashMap};
use std::ffi::OsString;
use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

pub const POLICY_JSON: &str = include_str!("../../../../packages/contracts/git-policy.json");

/// Environment variable marking a deny-mode askpass call (Windows: git runs `<exe> <prompt>`, so argv carries no flag).
pub const ASKPASS_DENY_ENV: &str = "THAIGIT_ASKPASS_DENY";

/// Operation kind: decides per-repo locking (`write`/`network` are exclusive) and cancellability (only `network`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExecKind {
    Read,
    Write,
    Network,
}

/// Environment profile: `background` (autofetch) never opens a sign-in dialog.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum EnvProfile {
    #[default]
    Interactive,
    Background,
}

impl EnvProfile {
    fn key(self) -> &'static str {
        match self {
            Self::Interactive => "interactive",
            Self::Background => "background",
        }
    }
}

/// The read-only shape of a `write` subcommand: matches when args START with exactly `args` and, unless `rest`, have
/// nothing after it (`remote -v` is read-only, `remote -v update` is not). A port of `ReadForm`/`matchesReadForm` (policy.ts).
#[derive(Debug, Clone, Deserialize)]
pub struct ReadForm {
    pub args: Vec<String>,
    #[serde(default)]
    pub rest: bool,
}

impl ReadForm {
    pub fn matches(&self, args: &[String]) -> bool {
        args.len() >= self.args.len() && self.args.iter().zip(args).all(|(want, got)| want == got) && (self.rest || args.len() == self.args.len())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubcommandRule {
    pub kind: ExecKind,
    #[serde(default)]
    pub allow_short: Vec<String>,
    #[serde(default)]
    pub allow_long: Vec<String>,
    pub allow_second: Option<Vec<String>>,
    #[serde(default)]
    pub typed_second: Vec<String>,
    /// Kind overridden by the first arg (`lfs fetch` → `network`); falls back to `kind`.
    #[serde(default)]
    pub second_kinds: BTreeMap<String, ExecKind>,
    #[serde(default)]
    pub reject_second: Vec<String>,
    /// First args in this list must be the ONLY arg (`remote -v` ok, `remote -v add …` blocked).
    #[serde(default)]
    pub alone_second: Vec<String>,
    #[serde(default)]
    pub read_forms: Vec<ReadForm>,
    pub require_any: Option<Vec<String>>,
    #[serde(default)]
    pub reject_extra_long: Vec<String>,
    #[serde(default)]
    pub reject_extra_short: Vec<String>,
    #[serde(default)]
    pub urls: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSafety {
    pub args: Vec<String>,
    pub after: Vec<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallerEnvRule {
    pub values: Option<Vec<String>>,
    pub path_inside: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PathFallback {
    pub macos: Vec<String>,
    pub windows: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvPolicy {
    pub set: BTreeMap<String, String>,
    pub set_if_missing: BTreeMap<String, String>,
    pub remove: Vec<String>,
    pub remove_prefixes: Vec<String>,
    pub from_caller: BTreeMap<String, CallerEnvRule>,
    pub profiles: BTreeMap<String, BTreeMap<String, String>>,
    pub path_fallback: PathFallback,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlPolicy {
    pub reject_prefixes: Vec<String>,
    pub reject_schemes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPolicy {
    version: u32,
    global_config: Vec<String>,
    diff_safety: DiffSafety,
    env: EnvPolicy,
    reject_long: Vec<String>,
    reject_short: Vec<String>,
    short_attached: Vec<String>,
    url: UrlPolicy,
    subcommands: HashMap<String, SubcommandRule>,
    #[serde(default)]
    config_set_allowlist: Vec<String>,
    #[serde(default)]
    network_kinds: Vec<String>,
}

#[derive(Debug)]
pub struct GitPolicy {
    pub version: u32,
    pub global_config: Vec<String>,
    pub diff_safety: DiffSafety,
    pub env: EnvPolicy,
    pub reject_long: Vec<String>,
    pub reject_short: Vec<String>,
    pub url: UrlPolicy,
    pub subcommands: HashMap<String, SubcommandRule>,
    pub config_set_allowlist: Vec<String>,
    pub network_kinds: Vec<String>,
    attached: Vec<Regex>,
}

/// A policy violation; `code()` matches the TypeScript version's codes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Violation {
    SubNotAllowed { sub: String },
    TypedOnly { sub: String, detail: String },
    SecondNotAllowed { sub: String, detail: String },
    ConfigWrite { sub: String },
    FlagRejected { sub: String, detail: String },
    AttachedShort { sub: String, detail: String },
    UrlRejected { sub: String, detail: String },
    EnvRejected { sub: String, detail: String },
    /// Rust only: a file-reading option must be given stdin (`-`).
    FileOptionNotStdin { sub: String, detail: String },
    /// Rust only: an absolute path / a `..` where it is not allowed.
    PathOutsideRepo { sub: String, detail: String },
}

impl Violation {
    pub fn code(&self) -> &'static str {
        match self {
            Self::SubNotAllowed { .. } => "sub-not-allowed",
            Self::TypedOnly { .. } => "typed-only",
            Self::SecondNotAllowed { .. } => "second-not-allowed",
            Self::ConfigWrite { .. } => "config-write",
            Self::FlagRejected { .. } => "flag-rejected",
            Self::AttachedShort { .. } => "attached-short",
            Self::UrlRejected { .. } => "url-rejected",
            Self::EnvRejected { .. } => "env-rejected",
            Self::FileOptionNotStdin { .. } => "file-option-not-stdin",
            Self::PathOutsideRepo { .. } => "path-outside-repo",
        }
    }

    pub fn detail(&self) -> String {
        match self {
            Self::SubNotAllowed { sub } | Self::ConfigWrite { sub } => sub.clone(),
            Self::TypedOnly { detail, .. }
            | Self::SecondNotAllowed { detail, .. }
            | Self::FlagRejected { detail, .. }
            | Self::AttachedShort { detail, .. }
            | Self::UrlRejected { detail, .. }
            | Self::EnvRejected { detail, .. }
            | Self::FileOptionNotStdin { detail, .. }
            | Self::PathOutsideRepo { detail, .. } => detail.clone(),
        }
    }
}

impl std::fmt::Display for Violation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} ({})", self.code(), self.detail())
    }
}

static URL_SCHEME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([a-z][a-z0-9+.-]*)::").expect("regex scheme hợp lệ"));

/// Options that read content from a file: only stdin (`-`) is accepted, so a command cannot become an arbitrary file read on
/// the machine.
/// Second field: the shortest abbreviation length git still treats as unique (`--fil` = `--file`; `--path=` of `hash-object` is
/// a different option, so no confusion). 0 = only the exact name matches.
const STDIN_ONLY_OPTIONS: &[(&str, usize)] = &[("-F", 0), ("--file", 5), ("--pathspec-from-file", 13)];

/// Dynamic loader environment variables (Linux `LD_*`, macOS `DYLD_*`): removed from git's base environment.
const LOADER_ENV_PREFIXES: [&str; 2] = ["LD_", "DYLD_"];

/// The `hash-object` args that are allowed (only `--stdin`, never a file).
const HASH_OBJECT_ALLOWED: &[&str] =
    &["--stdin", "-w", "--no-filters", "--literally", "-t", "blob", "tree", "commit", "tag"];

impl GitPolicy {
    pub fn parse(json: &str) -> Result<Self, String> {
        let raw: RawPolicy = serde_json::from_str(json).map_err(|e| format!("git-policy.json sai: {e}"))?;
        let attached = raw
            .short_attached
            .iter()
            .map(|p| Regex::new(p).map_err(|e| format!("shortAttached `{p}` sai: {e}")))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            version: raw.version,
            global_config: raw.global_config,
            diff_safety: raw.diff_safety,
            env: raw.env,
            reject_long: raw.reject_long,
            reject_short: raw.reject_short,
            url: raw.url,
            subcommands: raw.subcommands,
            config_set_allowlist: raw.config_set_allowlist,
            network_kinds: raw.network_kinds,
            attached,
        })
    }

    pub fn rule(&self, sub: &str) -> Option<&SubcommandRule> {
        self.subcommands.get(sub)
    }

    /// Validate a command before it runs (a port of `validateGitCommand`).
    pub fn validate(&self, sub: &str, args: &[String], env: &BTreeMap<String, String>) -> Option<Violation> {
        let Some(rule) = self.rule(sub) else {
            return Some(Violation::SubNotAllowed { sub: sub.to_string() });
        };
        let sub_owned = || sub.to_string();

        let second = args.first().map(String::as_str).unwrap_or("");
        if rule.reject_second.iter().any(|s| s == second) {
            return Some(Violation::SecondNotAllowed { sub: sub_owned(), detail: second.to_string() });
        }
        if let Some(allowed) = &rule.allow_second
            && !allowed.iter().any(|s| s == second)
        {
            if rule.typed_second.iter().any(|s| s == second) {
                return Some(Violation::TypedOnly { sub: sub_owned(), detail: format!("{sub} {second}") });
            }
            return Some(Violation::SecondNotAllowed { sub: sub_owned(), detail: second.to_string() });
        }
        // `remote -v add …` / `remote -v update`: git accepts `-v` before the subcommand, so checking the first arg alone is not enough.
        if args.len() > 1 && rule.alone_second.iter().any(|s| s == second) {
            return Some(Violation::SecondNotAllowed { sub: sub_owned(), detail: args[..2].join(" ") });
        }
        if let Some(required) = &rule.require_any
            && !args.iter().any(|a| required.iter().any(|r| r == a))
        {
            return Some(Violation::ConfigWrite { sub: sub_owned() });
        }

        let rejected_long: Vec<&String> = self.reject_long.iter().chain(rule.reject_extra_long.iter()).collect();
        let rejected_short: Vec<&String> = self.reject_short.iter().chain(rule.reject_extra_short.iter()).collect();

        let mut end_of_options = false;
        for arg in args {
            if !end_of_options && arg == "--" {
                end_of_options = true;
                continue;
            }
            let is_option = !end_of_options && arg.len() > 1 && arg.starts_with('-');
            if is_option && arg.starts_with("--") {
                let name = arg.split('=').next().unwrap_or(arg);
                if rule.allow_long.iter().any(|a| a == name) {
                    continue;
                }
                // git accepts long-name abbreviations (`--upl=` = `--upload-pack`): block every prefix of ≥ 3 chars.
                if utf16_len(name) >= 3 && rejected_long.iter().any(|r| r.as_str() == name || r.starts_with(name)) {
                    return Some(Violation::FlagRejected { sub: sub_owned(), detail: name.to_string() });
                }
                continue;
            }
            if is_option {
                let flag = short_flag(arg);
                let blocked = rejected_short.iter().any(|r| **r == flag);
                if blocked && !rule.allow_short.contains(&flag) {
                    return Some(Violation::FlagRejected { sub: sub_owned(), detail: flag });
                }
                if utf16_len(arg) > 2 && !self.attached.iter().any(|p| p.is_match(arg)) {
                    return Some(Violation::AttachedShort { sub: sub_owned(), detail: arg.clone() });
                }
                continue;
            }
            if rule.urls && self.is_rejected_url(arg) {
                return Some(Violation::UrlRejected { sub: sub_owned(), detail: arg.clone() });
            }
        }

        for (key, value) in env {
            let Some(allowed) = self.env.from_caller.get(key) else {
                return Some(Violation::EnvRejected { sub: sub_owned(), detail: key.clone() });
            };
            if let Some(values) = &allowed.values
                && !values.iter().any(|v| v == value)
            {
                return Some(Violation::EnvRejected { sub: sub_owned(), detail: format!("{key}={value}") });
            }
        }
        None
    }

    /// A dangerous URL: `ext::`, `fd::`, starting with `-`, or the `ext`/`fd` scheme (case-insensitive).
    pub fn is_rejected_url(&self, arg: &str) -> bool {
        let lower = arg.to_lowercase();
        if self.url.reject_prefixes.iter().any(|p| lower.starts_with(p.as_str())) {
            return true;
        }
        URL_SCHEME
            .captures(&lower)
            .and_then(|c| c.get(1))
            .is_some_and(|scheme| self.url.reject_schemes.iter().any(|s| s == scheme.as_str()))
    }

    /// An extra checking layer that exists only in Rust (it does not change results on the vectors): it blocks paths that turn a git command into an "arbitrary file read".
    pub fn check_scope(&self, sub: &str, args: &[String]) -> Option<Violation> {
        let sub_owned = || sub.to_string();
        // 1. A file-reading option only accepts stdin.
        let mut end_of_options = false;
        let mut index = 0;
        while index < args.len() {
            let arg = &args[index];
            index += 1;
            if !end_of_options && arg == "--" {
                end_of_options = true;
                continue;
            }
            if end_of_options || arg.len() < 2 || !arg.starts_with('-') {
                continue;
            }
            let (name, inline) = match arg.split_once('=') {
                Some((name, value)) => (name, Some(value)),
                None => (arg.as_str(), None),
            };
            let is_file_option = STDIN_ONLY_OPTIONS.iter().any(|(target, min_abbrev)| {
                name == *target || (*min_abbrev > 0 && utf16_len(name) >= *min_abbrev && target.starts_with(name))
            });
            if !is_file_option {
                continue;
            }
            let value = inline.or_else(|| args.get(index).map(String::as_str)).unwrap_or("");
            if value != "-" {
                return Some(Violation::FileOptionNotStdin { sub: sub_owned(), detail: arg.clone() });
            }
        }

        let positionals = || {
            let mut after_dd = false;
            args.iter().filter(move |a| {
                if !after_dd && a.as_str() == "--" {
                    after_dd = true;
                    return false;
                }
                after_dd || !a.starts_with('-') || a.len() == 1
            })
        };
        match sub {
            // `git diff <path> <path>` (including `--no-index`) can read any file outside the repo.
            "diff" => {
                for arg in positionals() {
                    if arg != "/dev/null" && arg != "NUL" && is_outside_repo_path(arg) {
                        return Some(Violation::PathOutsideRepo { sub: sub_owned(), detail: arg.clone() });
                    }
                }
            }
            "apply" | "am" => {
                for arg in positionals() {
                    if arg != "-" && !arg.bytes().all(|b| b.is_ascii_digit()) {
                        return Some(Violation::PathOutsideRepo { sub: sub_owned(), detail: arg.clone() });
                    }
                }
            }
            "hash-object" => {
                for arg in args {
                    if !HASH_OBJECT_ALLOWED.contains(&arg.as_str()) && !arg.starts_with("--path=") {
                        return Some(Violation::PathOutsideRepo { sub: sub_owned(), detail: arg.clone() });
                    }
                }
                if !args.iter().any(|a| a == "--stdin") {
                    return Some(Violation::PathOutsideRepo { sub: sub_owned(), detail: "thiếu --stdin".into() });
                }
            }
            _ => {}
        }
        None
    }

    /// The command (with these args) definitely runs nothing from the config: clean/smudge filters, textconv, external diff,
    /// merge driver, gpg program, credential helper… Used for an untrusted repo whose effective config can change after the
    /// scan (`include` pointing at a tracked file, `includeIf onbranch:`), where overrides built from that scan may already
    /// be stale: every other command is blocked until the user trusts the repo. Only purely object/ref-reading commands —
    /// NOT `status`/`diff` (comparing working-tree content with the index runs clean filters) nor write/network commands.
    pub fn is_exec_free(&self, sub: &str, args: &[String]) -> bool {
        if self.derived_kind(sub, args) != Some(ExecKind::Read) {
            return false;
        }
        let listed = match sub {
            "rev-parse" | "rev-list" | "for-each-ref" | "merge-base" | "check-ref-format" | "version" | "config" | "log" | "show"
            | "diff-tree" | "cat-file" | "ls-files" => true,
            // Only the declared read-only shapes (`remote`, `-v`, `get-url …`) reach here (`derived_kind` above): `remote show`
            // talks to the server and `remote -v update` fetches — neither is a read-only shape. No `stash`: `stash list -p` generates a
            // diff, and the policy only adds `--no-textconv` for `stash show`, so the repo's textconv may run.
            "remote" => true,
            _ => false,
        };
        if !listed {
            return false;
        }
        // Options (before `--`) make a read command run filters: git accepts long-name abbreviations, so block every prefix of ≥ 3 chars.
        let abbreviates = |name: &str, full: &str| utf16_len(name) >= 3 && name.starts_with("--") && full.starts_with(name);
        !args.iter().take_while(|arg| arg.as_str() != "--").any(|arg| {
            let name = arg.split('=').next().unwrap_or(arg);
            match sub {
                // `--textconv`/`--filters`: runs the repo's textconv/smudge.
                "cat-file" => abbreviates(name, "--textconv") || abbreviates(name, "--filters"),
                // `-m`/`--modified`: compares working-tree content with the index → runs clean filters (including when bundled as `-mz`).
                "ls-files" => {
                    abbreviates(name, "--modified") || (arg.starts_with('-') && !arg.starts_with("--") && arg.len() > 1 && arg[1..].contains('m'))
                }
                _ => false,
            }
        })
    }

    /// Effective kind of a command: the subcommand's kind (or the first arg's, `secondKinds`), except a `write` command whose
    /// args match a read-only shape (`readForms` in git-policy.json, matched against the WHOLE args shape) is `read`. A port of
    /// `effectiveKind` (policy.ts).
    pub fn derived_kind(&self, sub: &str, args: &[String]) -> Option<ExecKind> {
        let rule = self.rule(sub)?;
        let kind = args.first().and_then(|second| rule.second_kinds.get(second)).copied().unwrap_or(rule.kind);
        if kind == ExecKind::Write && rule.read_forms.iter().any(|form| form.matches(args)) {
            return Some(ExecKind::Read);
        }
        Some(kind)
    }

    /// Choose the operation kind for a request: it may be stronger than the policy (a tighter lock) but never weaker, and only a
    /// `network` subcommand may be `network` (cancellable, network-style exclusive lock).
    pub fn resolve_kind(&self, sub: &str, args: &[String], requested: ExecKind) -> Result<ExecKind, String> {
        let derived = self.derived_kind(sub, args).ok_or_else(|| format!("sub `{sub}` không có trong chính sách"))?;
        let ok = match derived {
            ExecKind::Network => requested == ExecKind::Network,
            _ => requested >= derived && requested != ExecKind::Network,
        };
        if ok {
            Ok(requested)
        } else {
            Err(format!("kind `{requested:?}` không hợp lệ cho `{sub}` (chính sách: `{derived:?}`)").to_lowercase())
        }
    }

    /// Args inserted before the subcommand (`-c k=v` …) and after it (`--no-ext-diff --no-textconv` for diff-producing commands).
    pub fn build_argv(&self, sub: &str, args: &[String]) -> Vec<String> {
        let mut argv: Vec<String> = Vec::with_capacity(self.global_config.len() * 2 + args.len() + 4);
        for entry in &self.global_config {
            argv.push("-c".to_string());
            argv.push(entry.clone());
        }
        let safety = self.diff_safety.after.iter().find(|path| {
            path.first().map(String::as_str) == Some(sub)
                && (path.len() == 1 || path.get(1).map(String::as_str) == args.first().map(String::as_str))
        });
        argv.push(sub.to_string());
        match safety {
            None => argv.extend(args.iter().cloned()),
            Some(path) => {
                let consumed = (path.len() - 1).min(args.len());
                argv.extend(args[..consumed].iter().cloned());
                argv.extend(self.diff_safety.args.iter().cloned());
                argv.extend(args[consumed..].iter().cloned());
            }
        }
        argv
    }

    /// Git environment derived from the base environment (a direct port of `GitEnvironment.swift` minus dropped vars).
    pub fn build_env(&self, base: EnvMap, options: &EnvOptions) -> EnvMap {
        let mut env = EnvMap::default();
        for (key, value) in base.into_pairs() {
            let name = key.to_string_lossy().into_owned();
            // `LD_*`/`DYLD_*` (PRELOAD, INSERT_LIBRARIES…) load arbitrary libraries into git: never inherited from the app's environment.
            let removed = self.env.remove.iter().any(|r| EnvMap::same_key(r, &name))
                || self.env.remove_prefixes.iter().any(|p| EnvMap::has_prefix(&name, p))
                || LOADER_ENV_PREFIXES.iter().any(|p| EnvMap::has_prefix(&name, p));
            if !removed {
                env.set_os(key, value);
            }
        }
        for (key, value) in &self.env.set {
            env.set(key, value);
        }
        for (key, value) in &self.env.set_if_missing {
            if env.get(key).is_none_or(|v| v.is_empty()) {
                env.set(key, value);
            }
        }
        if let Some(profile) = self.env.profiles.get(options.profile.key()) {
            for (key, value) in profile {
                match value.as_str() {
                    "<askpass>" => {
                        if let Some(path) = &options.askpass {
                            env.set(key, path.clone());
                        }
                    }
                    "<askpass-deny>" => {
                        if let Some(path) = &options.askpass_deny {
                            env.set(key, path.clone());
                            env.set(ASKPASS_DENY_ENV, "1");
                        }
                    }
                    literal => env.set(key, literal),
                }
            }
        }
        for (key, value) in &options.caller_env {
            env.set(key, value);
        }
        for (key, value) in &options.extra {
            env.set(key, value);
        }
        env
    }
}

#[derive(Debug, Clone, Default)]
pub struct EnvOptions {
    pub profile: EnvProfile,
    /// Env sent by the frontend (already through `validate`).
    pub caller_env: BTreeMap<String, String>,
    pub askpass: Option<OsString>,
    pub askpass_deny: Option<OsString>,
    /// Env Rust adds last (restricted mode: `GIT_CONFIG_*`, `GIT_PROXY_COMMAND`).
    pub extra: Vec<(String, String)>,
}

/// The env var table; on Windows variable names are case-insensitive.
#[derive(Debug, Default, Clone)]
pub struct EnvMap {
    entries: BTreeMap<String, (OsString, OsString)>,
}

impl EnvMap {
    fn canon(key: &str) -> String {
        if cfg!(windows) { key.to_ascii_uppercase() } else { key.to_string() }
    }

    fn same_key(a: &str, b: &str) -> bool {
        Self::canon(a) == Self::canon(b)
    }

    fn has_prefix(name: &str, prefix: &str) -> bool {
        Self::canon(name).starts_with(&Self::canon(prefix))
    }

    pub fn from_pairs(pairs: impl IntoIterator<Item = (OsString, OsString)>) -> Self {
        let mut map = Self::default();
        for (key, value) in pairs {
            map.set_os(key, value);
        }
        map
    }

    pub fn from_process() -> Self {
        Self::from_pairs(std::env::vars_os())
    }

    pub fn get(&self, key: &str) -> Option<&OsString> {
        self.entries.get(&Self::canon(key)).map(|(_, value)| value)
    }

    pub fn set(&mut self, key: &str, value: impl Into<OsString>) {
        self.entries.insert(Self::canon(key), (OsString::from(key), value.into()));
    }

    fn set_os(&mut self, key: OsString, value: OsString) {
        let canon = Self::canon(&key.to_string_lossy());
        self.entries.insert(canon, (key, value));
    }

    pub fn remove(&mut self, key: &str) {
        self.entries.remove(&Self::canon(key));
    }

    pub fn into_pairs(self) -> Vec<(OsString, OsString)> {
        self.entries.into_values().collect()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&OsString, &OsString)> {
        self.entries.values().map(|(key, value)| (key, value))
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

static POLICY: LazyLock<GitPolicy> =
    LazyLock::new(|| GitPolicy::parse(POLICY_JSON).expect("git-policy.json nhúng sẵn phải hợp lệ (test `policy_parses`)"));

/// The policy embedded at compile time.
pub fn policy() -> &'static GitPolicy {
    &POLICY
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// The first two characters of a short option (`-c` in `-ccore.x=y`), like the TS version's `arg.slice(0, 2)`.
fn short_flag(arg: &str) -> String {
    arg.chars().take(2).collect()
}

/// `git diff --no-index`: git ignores the index and reads straight through the file system (following every symlink in the
/// parent directory). Git accepts only the exact string `--no-index` (no abbreviations), and only before the first operand or `--`.
pub fn is_no_index_diff(sub: &str, args: &[String]) -> bool {
    sub == "diff" && args.iter().take_while(|arg| arg.as_str() != "--").any(|arg| arg == "--no-index")
}

/// An absolute path (`/x`, `\x`, `C:\x`, `C:/x`) or one containing a `..` segment.
fn is_outside_repo_path(arg: &str) -> bool {
    if arg.starts_with('/') || arg.starts_with('\\') {
        return true;
    }
    let bytes = arg.as_bytes();
    if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && (bytes[2] == b'/' || bytes[2] == b'\\')
    {
        return true;
    }
    arg.split(['/', '\\']).any(|segment| segment == "..")
}

#[cfg(test)]
mod tests {
    use super::*;

    const VECTORS_JSON: &str = include_str!("../../../../packages/contracts/git-policy.vectors.json");

    #[derive(Deserialize)]
    struct Vector {
        sub: String,
        args: Vec<String>,
        #[serde(default)]
        env: BTreeMap<String, String>,
        reject: Option<String>,
    }

    #[derive(Deserialize)]
    struct KindVector {
        sub: String,
        args: Vec<String>,
        kind: Option<String>,
    }

    #[derive(Deserialize)]
    struct Vectors {
        cases: Vec<Vector>,
        kinds: Vec<KindVector>,
    }

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn policy_parses() {
        let p = policy();
        assert_eq!(p.version, 1);
        assert!(p.subcommands.len() >= 30);
    }

    #[test]
    fn vectors_match_reference() {
        let vectors: Vectors = serde_json::from_str(VECTORS_JSON).unwrap();
        assert!(vectors.cases.len() >= 50, "thiếu ca kiểm thử dùng chung");
        let mut failures = Vec::new();
        for case in &vectors.cases {
            let got = policy().validate(&case.sub, &case.args, &case.env).map(|v| v.code().to_string());
            if got != case.reject {
                failures.push(format!("{} {:?} env={:?}: mong {:?}, được {:?}", case.sub, case.args, case.env, case.reject, got));
            }
        }
        assert!(failures.is_empty(), "lệch bản tham chiếu TS:\n{}", failures.join("\n"));
    }

    #[test]
    fn kinds_match_reference() {
        let vectors: Vectors = serde_json::from_str(VECTORS_JSON).unwrap();
        assert!(vectors.kinds.len() >= 30, "thiếu ca loại thao tác dùng chung");
        let mut failures = Vec::new();
        for case in &vectors.kinds {
            let got = policy().derived_kind(&case.sub, &case.args).map(|kind| format!("{kind:?}").to_lowercase());
            if got != case.kind {
                failures.push(format!("{} {:?}: mong {:?}, được {:?}", case.sub, case.args, case.kind, got));
            }
        }
        assert!(failures.is_empty(), "lệch bản tham chiếu TS (effectiveKind):\n{}", failures.join("\n"));
    }

    #[test]
    fn every_read_form_of_a_write_subcommand_passes_validation() {
        let vectors: Vectors = serde_json::from_str(VECTORS_JSON).unwrap();
        for case in vectors.kinds.iter().filter(|c| c.kind.as_deref() == Some("read")) {
            if policy().rule(&case.sub).is_some_and(|rule| rule.kind == ExecKind::Write) {
                assert_eq!(policy().validate(&case.sub, &case.args, &BTreeMap::new()), None, "{} {:?}", case.sub, case.args);
            }
        }
    }

    #[test]
    fn rejects_the_mandatory_attack_cases() {
        let none = BTreeMap::new();
        let p = policy();
        let flag = p.validate("status", &strings(&["-c", "core.fsmonitor=touch /tmp/pwned"]), &none);
        assert_eq!(flag.map(|v| v.code()), Some("flag-rejected"));
        let upload = p.validate("fetch", &strings(&["--upload-pack=touch /tmp/pwned", "origin"]), &none);
        assert_eq!(upload.map(|v| v.code()), Some("flag-rejected"));
        let ext = p.validate("pull", &strings(&["ext::sh -c touch% /tmp/pwned", "main"]), &none);
        assert_eq!(ext.map(|v| v.code()), Some("url-rejected"));
        let mut env = BTreeMap::new();
        env.insert("GIT_SSH_COMMAND".to_string(), "sh -c id".to_string());
        assert_eq!(p.validate("status", &[], &env).map(|v| v.code()), Some("env-rejected"));
        assert_eq!(p.validate("difftool", &[], &none).map(|v| v.code()), Some("sub-not-allowed"));
        assert_eq!(p.validate("__proto__", &[], &none).map(|v| v.code()), Some("sub-not-allowed"));
        // the alias does not run: its name is not in the allowlist.
        assert_eq!(p.validate("co", &[], &none).map(|v| v.code()), Some("sub-not-allowed"));
    }

    #[test]
    fn long_option_abbreviations_are_blocked() {
        let none = BTreeMap::new();
        for name in ["--upl=x", "--upload", "--exe=x", "--rec=x", "--con=core.x=y", "--out=/tmp/x"] {
            let result = policy().validate("fetch", &strings(&[name, "origin"]), &none);
            assert_eq!(result.map(|v| v.code()), Some("flag-rejected"), "{name}");
        }
        // A longer valid option than the blocked prefix is still allowed.
        let ok = policy().validate("diff", &strings(&["--output-indicator-new=+"]), &none);
        assert_eq!(ok, None);
    }

    #[test]
    fn global_flags_contain_the_swift_eight_and_the_safety_three() {
        let flags = &policy().global_config;
        for expected in [
            "core.quotepath=false",
            "color.ui=false",
            "core.pager=cat",
            "log.showSignature=false",
            "diff.noprefix=false",
            "diff.mnemonicPrefix=false",
            "advice.detachedHead=false",
            "core.fsmonitor=false",
            "safe.bareRepository=explicit",
            "protocol.file.allow=user",
            "protocol.ext.allow=never",
        ] {
            assert!(flags.iter().any(|f| f == expected), "thiếu {expected}");
        }
        assert_eq!(flags.len(), 11);
    }

    #[test]
    fn build_argv_inserts_config_before_subcommand() {
        let argv = policy().build_argv("status", &strings(&["--porcelain=v2"]));
        assert_eq!(&argv[..2], &["-c", "core.quotepath=false"]);
        assert!(argv.iter().any(|a| a == "core.fsmonitor=false"));
        assert_eq!(&argv[argv.len() - 2..], &["status", "--porcelain=v2"]);
    }

    #[test]
    fn diff_commands_always_get_no_ext_diff_and_no_textconv() {
        let p = policy();
        let tail = |sub: &str, args: &[&str], n: usize| {
            let argv = p.build_argv(sub, &strings(args));
            argv[argv.len() - n..].to_vec()
        };
        assert_eq!(tail("diff", &["--cached"], 4), ["diff", "--no-ext-diff", "--no-textconv", "--cached"]);
        assert_eq!(tail("log", &["-p"], 4), ["log", "--no-ext-diff", "--no-textconv", "-p"]);
        assert_eq!(tail("show", &["abc"], 4), ["show", "--no-ext-diff", "--no-textconv", "abc"]);
        assert_eq!(tail("diff-tree", &["-r"], 4), ["diff-tree", "--no-ext-diff", "--no-textconv", "-r"]);
        // `stash show`: inserted after "show", unlike `stash push`.
        assert_eq!(tail("stash", &["show", "-p"], 5), ["stash", "show", "--no-ext-diff", "--no-textconv", "-p"]);
        assert!(!p.build_argv("stash", &strings(&["push"])).iter().any(|a| a == "--no-ext-diff"));
        assert!(!p.build_argv("status", &[]).iter().any(|a| a == "--no-ext-diff"));
    }

    fn base_env(pairs: &[(&str, &str)]) -> EnvMap {
        EnvMap::from_pairs(pairs.iter().map(|(k, v)| (OsString::from(k), OsString::from(v))))
    }

    fn lookup(env: &EnvMap, key: &str) -> Option<String> {
        env.get(key).map(|v| v.to_string_lossy().into_owned())
    }

    #[test]
    fn build_env_ports_the_swift_environment() {
        let base = base_env(&[
            ("PATH", "/usr/bin"),
            ("LC_ALL", "vi_VN.UTF-8"),
            ("GIT_DIR", "/tmp/x"),
            ("GIT_WORK_TREE", "/tmp/y"),
            ("GIT_INDEX_FILE", "/tmp/z"),
            ("GIT_CONFIG_PARAMETERS", "'core.pager=evil'"),
            ("GIT_CONFIG_COUNT", "1"),
            ("GIT_CONFIG_KEY_0", "core.pager"),
            ("GIT_CONFIG_VALUE_0", "evil"),
            ("GIT_EXEC_PATH", "/tmp/evil"),
            ("HOME", "/Users/a"),
        ]);
        let options = EnvOptions {
            profile: EnvProfile::Background,
            askpass_deny: Some(OsString::from("/data/askpass-deny.sh")),
            ..Default::default()
        };
        let env = policy().build_env(base, &options);
        for gone in [
            "LC_ALL", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT",
            "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_EXEC_PATH",
        ] {
            assert_eq!(lookup(&env, gone), None, "{gone} phải bị bỏ");
        }
        assert_eq!(lookup(&env, "LANGUAGE").as_deref(), Some("en"));
        assert_eq!(lookup(&env, "LC_MESSAGES").as_deref(), Some("C"));
        assert_eq!(lookup(&env, "LANG").as_deref(), Some("en_US.UTF-8"));
        assert_eq!(lookup(&env, "GIT_TERMINAL_PROMPT").as_deref(), Some("0"));
        assert_eq!(lookup(&env, "GIT_EDITOR").as_deref(), Some("true"));
        assert_eq!(lookup(&env, "GIT_MERGE_AUTOEDIT").as_deref(), Some("no"));
        assert_eq!(lookup(&env, "GIT_PAGER").as_deref(), Some("cat"));
        assert_eq!(lookup(&env, "PAGER").as_deref(), Some("cat"));
        assert_eq!(lookup(&env, "GCM_INTERACTIVE").as_deref(), Some("never"));
        assert_eq!(lookup(&env, "GIT_ASKPASS").as_deref(), Some("/data/askpass-deny.sh"));
        assert_eq!(lookup(&env, "SSH_ASKPASS").as_deref(), Some("/data/askpass-deny.sh"));
        assert_eq!(lookup(&env, "SSH_ASKPASS_REQUIRE").as_deref(), Some("force"));
        assert_eq!(lookup(&env, ASKPASS_DENY_ENV).as_deref(), Some("1"));
        assert_eq!(lookup(&env, "HOME").as_deref(), Some("/Users/a"));
    }

    #[test]
    fn build_env_keeps_existing_lang_and_fills_a_missing_or_empty_one() {
        let kept = policy().build_env(base_env(&[("LANG", "vi_VN.UTF-8")]), &EnvOptions::default());
        assert_eq!(lookup(&kept, "LANG").as_deref(), Some("vi_VN.UTF-8"));
        let filled = policy().build_env(base_env(&[("LANG", "")]), &EnvOptions::default());
        assert_eq!(lookup(&filled, "LANG").as_deref(), Some("en_US.UTF-8"));
    }

    #[test]
    fn interactive_profile_leaves_askpass_unset_until_phase_2b() {
        let env = policy().build_env(base_env(&[]), &EnvOptions::default());
        assert_eq!(lookup(&env, "GIT_ASKPASS"), None);
        assert_eq!(lookup(&env, "GCM_INTERACTIVE"), None);
        assert_eq!(lookup(&env, ASKPASS_DENY_ENV), None);
    }

    #[test]
    fn caller_env_is_applied_last() {
        let mut caller = BTreeMap::new();
        caller.insert("GIT_OPTIONAL_LOCKS".to_string(), "0".to_string());
        let options = EnvOptions { caller_env: caller, ..Default::default() };
        let env = policy().build_env(base_env(&[]), &options);
        assert_eq!(lookup(&env, "GIT_OPTIONAL_LOCKS").as_deref(), Some("0"));
    }

    #[test]
    fn kind_resolution() {
        let p = policy();
        let args = strings(&[]);
        assert_eq!(p.resolve_kind("status", &args, ExecKind::Read), Ok(ExecKind::Read));
        assert_eq!(p.resolve_kind("status", &args, ExecKind::Write), Ok(ExecKind::Write));
        assert!(p.resolve_kind("status", &args, ExecKind::Network).is_err());
        assert!(p.resolve_kind("commit", &args, ExecKind::Read).is_err());
        assert_eq!(p.resolve_kind("commit", &args, ExecKind::Write), Ok(ExecKind::Write));
        assert!(p.resolve_kind("commit", &args, ExecKind::Network).is_err());
        assert_eq!(p.resolve_kind("fetch", &args, ExecKind::Network), Ok(ExecKind::Network));
        assert!(p.resolve_kind("fetch", &args, ExecKind::Write).is_err());
        assert!(p.resolve_kind("fetch", &args, ExecKind::Read).is_err());
        // A read-only form of a `write` subcommand.
        assert_eq!(p.resolve_kind("stash", &strings(&["list"]), ExecKind::Read), Ok(ExecKind::Read));
        assert!(p.resolve_kind("stash", &strings(&["pop"]), ExecKind::Read).is_err());
        assert_eq!(p.resolve_kind("remote", &strings(&["-v"]), ExecKind::Read), Ok(ExecKind::Read));
        assert!(p.resolve_kind("remote", &strings(&["remove", "x"]), ExecKind::Read).is_err());
        // `-v` before a different subcommand is no longer a read-only form; `remote show` talks to the server, so it is not one either.
        assert!(p.resolve_kind("remote", &strings(&["-v", "update"]), ExecKind::Read).is_err());
        assert!(p.resolve_kind("remote", &strings(&["--verbose", "add", "x", "u"]), ExecKind::Read).is_err());
        assert!(p.resolve_kind("remote", &strings(&["show", "origin"]), ExecKind::Read).is_err());
        assert_eq!(p.resolve_kind("remote", &strings(&["show", "origin"]), ExecKind::Write), Ok(ExecKind::Write));
        assert_eq!(p.resolve_kind("remote", &strings(&["get-url", "origin"]), ExecKind::Read), Ok(ExecKind::Read));
        assert!(p.resolve_kind("nope", &args, ExecKind::Read).is_err());
    }

    #[test]
    fn scope_layer_blocks_arbitrary_file_reads() {
        let p = policy();
        let code = |sub: &str, args: &[&str]| p.check_scope(sub, &strings(args)).map(|v| v.code());
        // a diff reading a file outside the repo
        assert_eq!(code("diff", &["--no-index", "--", "/dev/null", "/etc/passwd"]), Some("path-outside-repo"));
        assert_eq!(code("diff", &["/etc/hosts", "/etc/passwd"]), Some("path-outside-repo"));
        assert_eq!(code("diff", &["--", "../secret"]), Some("path-outside-repo"));
        assert_eq!(code("diff", &["--no-index", "--", "/dev/null", "src/a.ts"]), None);
        assert_eq!(code("diff", &["HEAD~3..HEAD", "--", "a/b.txt"]), None);
        assert_eq!(code("diff", &["--cached", "-M", "-U3", "--", "a.txt"]), None);
        // -F / --file / --pathspec-from-file only accept stdin
        assert_eq!(code("commit", &["-F", "/etc/passwd"]), Some("file-option-not-stdin"));
        assert_eq!(code("commit", &["--file=/etc/passwd"]), Some("file-option-not-stdin"));
        assert_eq!(code("add", &["--pathspec-from-file=/etc/passwd"]), Some("file-option-not-stdin"));
        assert_eq!(code("add", &["--pathspec-from-file", "/etc/passwd"]), Some("file-option-not-stdin"));
        assert_eq!(code("commit", &["-F", "-", "--cleanup=strip"]), None);
        assert_eq!(code("add", &["--pathspec-from-file=-", "--pathspec-file-nul"]), None);
        // apply / am / hash-object
        assert_eq!(code("apply", &["--cached", "-"]), None);
        assert_eq!(code("apply", &["--cached", "/etc/passwd"]), Some("path-outside-repo"));
        assert_eq!(code("hash-object", &["/etc/passwd"]), Some("path-outside-repo"));
        assert_eq!(code("hash-object", &["--stdin", "-w", "-t", "blob"]), None);
        assert_eq!(code("hash-object", &["--stdin-paths"]), Some("path-outside-repo"));
        // other commands are unaffected (a free-form message starting with "/")
        assert_eq!(code("stash", &["push", "--message", "/dev/null xử lý lỗi"]), None);
    }

    #[test]
    fn exec_free_allowlist_is_read_plumbing_only() {
        let p = policy();
        let free = |sub: &str, args: &[&str]| p.is_exec_free(sub, &strings(args));
        for (sub, args) in [
            ("log", vec!["-z", "--format=%H%x1f%P", "--all"]),
            ("rev-parse", vec!["--verify", "HEAD"]),
            ("for-each-ref", vec!["--format=%(refname)"]),
            ("cat-file", vec!["-p", "HEAD"]),
            ("cat-file", vec!["blob", "HEAD:a.txt"]),
            ("ls-files", vec!["-z", "--cached"]),
            ("ls-files", vec!["-o", "--exclude-standard", "-z"]),
            ("show", vec!["HEAD"]),
            ("diff-tree", vec!["-r", "--root", "HEAD"]),
            ("rev-list", vec!["--all", "--count"]),
            ("merge-base", vec!["a", "b"]),
            ("config", vec!["--get", "user.name"]),
            ("config", vec!["--list"]),
            ("remote", vec!["-v"]),
            ("remote", vec![]),
            ("remote", vec!["get-url", "origin"]),
            ("version", vec![]),
            ("check-ref-format", vec!["--branch", "x"]),
        ] {
            assert!(free(sub, &args), "{sub} {args:?} phải được phép");
        }
        for (sub, args) in [
            ("status", vec![]),
            ("status", vec!["--porcelain=v2"]),
            ("diff", vec![]),
            ("diff", vec!["--cached"]),
            ("diff", vec!["HEAD~1", "HEAD"]),
            ("add", vec!["--", "a"]),
            ("checkout", vec!["x"]),
            ("switch", vec!["x"]),
            ("restore", vec!["a"]),
            ("stash", vec![]),
            ("stash", vec!["pop"]),
            ("stash", vec!["show"]),
            ("stash", vec!["list", "-p"]),
            ("stash", vec!["list"]),
            ("merge", vec!["x"]),
            ("rebase", vec!["x"]),
            ("cherry-pick", vec!["x"]),
            ("revert", vec!["x"]),
            ("commit", vec!["-m", "x"]),
            ("apply", vec!["-"]),
            ("am", vec!["-"]),
            ("reset", vec!["--hard"]),
            ("rm", vec!["a"]),
            ("tag", vec![]),
            ("branch", vec![]),
            ("bisect", vec!["start"]),
            ("update-ref", vec!["HEAD", "x"]),
            ("symbolic-ref", vec!["HEAD"]),
            ("hash-object", vec!["--stdin"]),
            ("fetch", vec!["--all"]),
            ("pull", vec![]),
            ("push", vec![]),
            ("ls-remote", vec!["origin"]),
            ("remote", vec!["show", "origin"]),
            ("remote", vec!["-v", "update"]),
            ("remote", vec!["--verbose", "add", "x", "u"]),
            ("remote", vec!["-v", "prune", "origin"]),
            ("remote", vec!["prune", "origin"]),
            ("remote", vec!["remove", "origin"]),
            ("no-such-sub", vec![]),
        ] {
            assert!(!free(sub, &args), "{sub} {args:?} phải bị chặn");
        }
        // `cat-file --textconv/--filters` and `ls-files -m` run the repo's filters/textconv (including abbreviated and bundled forms).
        for args in [vec!["--textconv", "HEAD:a"], vec!["--filters", "HEAD:a"], vec!["--textc", "HEAD:a"], vec!["--filt", "HEAD:a"], vec!["--textconv=x"], vec!["--batch", "--filters"]] {
            assert!(!free("cat-file", &args), "cat-file {args:?}");
        }
        for args in [vec!["-m"], vec!["--modified"], vec!["--mod"], vec!["-mz"], vec!["-om"], vec!["-z", "-m"], vec!["--cached", "-m", "--", "a"]] {
            assert!(!free("ls-files", &args), "ls-files {args:?}");
        }
        // after `--` it is a path, not an option.
        assert!(free("ls-files", &["--cached", "--", "-m"]));
    }

    #[test]
    fn no_index_detection_is_exact_and_stops_at_double_dash() {
        let yes = |args: &[&str]| is_no_index_diff("diff", &strings(args));
        assert!(yes(&["--no-index", "--", "a", "b"]));
        assert!(yes(&["--no-color", "-U3", "--no-index", "--", "/dev/null", "a"]));
        assert!(!yes(&["--", "--no-index", "a"]));
        assert!(!yes(&["--no-ind", "--", "a"]), "git không nhận viết tắt của --no-index");
        assert!(!yes(&["--cached", "--", "a"]));
        assert!(!is_no_index_diff("log", &strings(&["--no-index"])));
    }

    #[test]
    fn loader_environment_is_never_inherited_by_git() {
        let base = base_env(&[
            ("PATH", "/usr/bin"),
            ("LD_PRELOAD", "/tmp/evil.so"),
            ("LD_LIBRARY_PATH", "/tmp"),
            ("DYLD_INSERT_LIBRARIES", "/tmp/evil.dylib"),
            ("DYLD_LIBRARY_PATH", "/tmp"),
            ("LDFLAGS", "-L/x"),
            ("HOME", "/Users/a"),
        ]);
        let env = policy().build_env(base, &EnvOptions::default());
        for gone in ["LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH"] {
            assert_eq!(lookup(&env, gone), None, "{gone} phải bị bỏ");
        }
        assert_eq!(lookup(&env, "LDFLAGS").as_deref(), Some("-L/x"), "chỉ tiền tố LD_ / DYLD_");
        assert_eq!(lookup(&env, "HOME").as_deref(), Some("/Users/a"));
    }

    #[test]
    fn every_vector_marked_allowed_passes_the_scope_layer() {
        let vectors: Vectors = serde_json::from_str(VECTORS_JSON).unwrap();
        for case in vectors.cases.iter().filter(|c| c.reject.is_none()) {
            assert_eq!(
                policy().check_scope(&case.sub, &case.args),
                None,
                "lớp kiểm thêm chặn nhầm ca hợp lệ {} {:?}",
                case.sub,
                case.args
            );
        }
    }

    #[test]
    fn rejected_url_forms() {
        let p = policy();
        for url in ["ext::sh -c id", "EXT::sh", "fd::17", "FD::1", "-oProxyCommand=x", "-", "ext::"] {
            assert!(p.is_rejected_url(url), "{url}");
        }
        for url in ["https://github.com/a/b.git", "git@github.com:a/b.git", "/srv/repos/x.git", "ssh://host/x", "origin"] {
            assert!(!p.is_rejected_url(url), "{url}");
        }
    }

    #[test]
    fn utf16_semantics_match_javascript() {
        // `-😀`: 3 UTF-16 units in JS → treated as bundled options and blocked; it is 2 chars in Rust but must still match.
        let result = policy().validate("status", &strings(&["-😀"]), &BTreeMap::new());
        assert_eq!(result.map(|v| v.code()), Some("attached-short"));
        let ok = policy().validate("status", &strings(&["-é"]), &BTreeMap::new());
        assert_eq!(ok, None);
    }
}
