//! Rust's repo registry: `repoId` → normalised directory + trust state; it issues "folder tokens" for paths coming from a
//! native dialog / "Open With", and stores the recent-repo list. JS never passes an arbitrary path.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::errors::{AppError, Result};
use crate::pathutil::{canonical, path_key, relative_to};
use crate::store;
use crate::trust::{self, ConfigEntry, Finding, Restrictions, TrustStore, hex};

const GRANT_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_RECENT: usize = 20;

/// Files larger than this are only compared by (length, mtime), without hashing content.
const STAMP_HASH_LIMIT: u64 = 1024 * 1024;

/// A file's fingerprint: length + mtime + content hash. Hashing so an edit that keeps the length within the same mtime
/// tick (a coarse-resolution volume, or a reset mtime) is still detected. `None` = missing / unreadable.
#[derive(Debug, Clone, PartialEq, Eq)]
struct FileStamp {
    len: u64,
    modified: Option<SystemTime>,
    digest: Option<[u8; 32]>,
}

fn stamp_of(path: &Path) -> Option<FileStamp> {
    let metadata = std::fs::metadata(path).ok()?;
    let digest = (metadata.is_file() && metadata.len() <= STAMP_HASH_LIMIT)
        .then(|| std::fs::read(path).ok())
        .flatten()
        .map(|bytes| Sha256::digest(&bytes).into());
    Some(FileStamp { len: metadata.len(), modified: metadata.modified().ok(), digest })
}

/// The fingerprint of every file deciding an untrusted repo's effective config: a change → rescan. It covers `<commonDir>/config`,
/// `<gitDir>/config.worktree`, `<gitDir>/HEAD` (`includeIf onbranch:` changes effect on a branch switch) and every file the
/// scan read or will read through `include` (see `trust::config_files`), including files that did not exist during the scan.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ConfigFingerprint {
    files: Vec<(PathBuf, Option<FileStamp>)>,
    /// The scan was interrupted by a write: always treat it as changed so the next command run rescans.
    volatile: bool,
}

impl ConfigFingerprint {
    /// Files that certainly decide the effective config (no need to know the scan result).
    pub fn base_paths(git_dir: &Path, common_dir: &Path) -> Vec<PathBuf> {
        vec![common_dir.join("config"), git_dir.join("config.worktree"), git_dir.join("HEAD")]
    }

    /// Fingerprint the given paths (deduplicated).
    pub fn capture(paths: impl IntoIterator<Item = PathBuf>) -> Self {
        let mut paths: Vec<PathBuf> = paths.into_iter().collect();
        paths.sort();
        paths.dedup();
        let files = paths
            .into_iter()
            .map(|path| {
                let stamp = stamp_of(&path);
                (path, stamp)
            })
            .collect();
        Self { files, volatile: false }
    }

    /// The tracked files.
    pub fn paths(&self) -> impl Iterator<Item = &Path> {
        self.files.iter().map(|(path, _)| path.as_path())
    }

    /// Is every fingerprinted file unchanged since it was fingerprinted?
    pub fn unchanged(&self) -> bool {
        !self.volatile && self.files.iter().all(|(path, stamp)| stamp_of(path) == *stamp)
    }

    /// Does every file present in `before` still carry the same fingerprint in `self` (i.e. no write slipped in between the two snapshots)?
    pub fn consistent_with(&self, before: &Self) -> bool {
        before.files.iter().all(|(path, stamp)| self.files.iter().find(|(p, _)| p == path).is_none_or(|(_, now)| now == stamp))
    }

    /// The fingerprint always reports "changed".
    pub fn into_volatile(mut self) -> Self {
        self.volatile = true;
        self
    }
}

/// An opened repo. Immutable: changing the trust state means replacing it with a new entry with the same `id`.
#[derive(Debug)]
pub struct RepoEntry {
    pub id: String,
    pub root: PathBuf,
    pub git_dir: PathBuf,
    pub common_dir: PathBuf,
    /// The per-repo lock: `path_key(realpath(commonDir))`.
    pub common_key: String,
    pub trusted: bool,
    pub findings: Vec<Finding>,
    pub findings_hash: String,
    pub entries: Vec<ConfigEntry>,
    /// Restricted mode: sometimes not trusted.
    pub restrictions: Option<Restrictions>,
    pub fingerprint: ConfigFingerprint,
}

/// The `open_repo` result (matching `OpenedRepo` in `packages/contracts/src/ipc.ts`).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenedRepo {
    pub repo_id: String,
    pub root: String,
    pub git_dir: String,
    pub common_dir: String,
    /// `trusted` | `unknown`.
    pub trust: &'static str,
    pub findings: Vec<String>,
}

impl RepoEntry {
    pub fn opened(&self) -> OpenedRepo {
        OpenedRepo {
            repo_id: self.id.clone(),
            root: self.root.to_string_lossy().into_owned(),
            git_dir: self.git_dir.to_string_lossy().into_owned(),
            common_dir: self.common_dir.to_string_lossy().into_owned(),
            trust: if self.trusted { "trusted" } else { "unknown" },
            findings: self.findings.iter().map(|f| f.display.clone()).collect(),
        }
    }
}

/// The repo's identity code: a hash of the working tree's real path (the same repo opened in several windows gets the same id).
pub fn repo_id_for(root: &Path) -> String {
    hex(&Sha256::digest(path_key(root).as_bytes()))[..16].to_string()
}

/// A directory Rust granted to the webview: the token is used for `open_repo` / `git_clone` / `git_init`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PickedFolder {
    pub token: String,
    /// The folder's name (for display).
    pub name: String,
    /// The full path — display only; Rust never accepts a path back from JS.
    pub path: String,
}

struct Grant {
    path: PathBuf,
    expires: Instant,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentRepo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub last_opened: u64,
}

#[derive(Default, Serialize, Deserialize)]
struct RecentFile {
    #[serde(default)]
    items: Vec<RecentRepo>,
}

pub struct Registry {
    repos: RwLock<HashMap<String, Arc<RepoEntry>>>,
    /// Hash of the command-running key set the webview was last shown (the `open_repo`/`trust_repo` result): `trust_repo` trusts
    /// exactly that set, not anything that changed afterwards without the user seeing it.
    reported: Mutex<HashMap<String, String>>,
    grants: Mutex<HashMap<String, Grant>>,
    recent: Mutex<Vec<RecentRepo>>,
    recent_path: PathBuf,
    launch: Mutex<Vec<PathBuf>>,
    /// The repo to open in a specific window (window label → directory): a worktree / submodule opened in a new window.
    window_launch: Mutex<HashMap<String, PathBuf>>,
    pub trust: TrustStore,
}

/// Where a repo open comes from: a dialog / "Open With" / native drop token, or an id in the recent list.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OpenSource {
    Picked { token: String },
    Recent { id: String },
}

fn folder_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

impl Registry {
    pub fn new(data_dir: &Path) -> Self {
        let recent_path = data_dir.join("recent.json");
        let items = store::read_json::<RecentFile>(&recent_path).map(|f| f.items).unwrap_or_default();
        Self {
            repos: RwLock::new(HashMap::new()),
            reported: Mutex::new(HashMap::new()),
            grants: Mutex::new(HashMap::new()),
            recent: Mutex::new(items),
            recent_path,
            launch: Mutex::new(Vec::new()),
            window_launch: Mutex::new(HashMap::new()),
            trust: TrustStore::new(data_dir),
        }
    }

    // MARK: - folder tokens

    /// Issue a token for a (already canonicalised) directory the user just picked with a native dialog.
    pub fn grant_folder(&self, path: &Path) -> PickedFolder {
        let token = uuid::Uuid::new_v4().simple().to_string();
        let mut grants = self.grants.lock().unwrap_or_else(|p| p.into_inner());
        let now = Instant::now();
        grants.retain(|_, g| g.expires > now);
        grants.insert(token.clone(), Grant { path: path.to_path_buf(), expires: now + GRANT_TTL });
        PickedFolder { token, name: folder_name(path), path: path.to_string_lossy().into_owned() }
    }

    /// Look at a token without consuming it (clone / init retry when the URL was wrong).
    pub fn peek_grant(&self, token: &str) -> Result<PathBuf> {
        let grants = self.grants.lock().unwrap_or_else(|p| p.into_inner());
        grants
            .get(token)
            .filter(|g| g.expires > Instant::now())
            .map(|g| g.path.clone())
            .ok_or_else(|| AppError::NotFound("Mã thư mục không còn hiệu lực — hãy chọn lại thư mục".into()))
    }

    /// Consume a token (single use).
    pub fn take_grant(&self, token: &str) -> Result<PathBuf> {
        let path = self.peek_grant(token)?;
        self.grants.lock().unwrap_or_else(|p| p.into_inner()).remove(token);
        Ok(path)
    }

    pub fn forget_grant(&self, token: &str) {
        self.grants.lock().unwrap_or_else(|p| p.into_inner()).remove(token);
    }

    /// A path the OS handed us at startup (argv, "Open With"): waiting for JS to take it once.
    pub fn push_launch_paths(&self, paths: Vec<PathBuf>) {
        self.launch.lock().unwrap_or_else(|p| p.into_inner()).extend(paths);
    }

    pub fn take_launch_paths(&self) -> Vec<PickedFolder> {
        let paths: Vec<PathBuf> = std::mem::take(&mut *self.launch.lock().unwrap_or_else(|p| p.into_inner()));
        paths.iter().filter_map(|p| canonical(p).ok()).filter(|p| p.is_dir()).map(|p| self.grant_folder(&p)).collect()
    }

    /// Record the repo to open for window `label` (set BEFORE the window is built so it can read it right at startup).
    pub fn set_window_launch(&self, label: &str, path: PathBuf) {
        self.window_launch.lock().unwrap_or_else(|p| p.into_inner()).insert(label.to_string(), path);
    }

    /// Like `take_launch_paths` but prefers the repo reserved for window `label` (a worktree / submodule opened in a new window).
    pub fn take_launch_paths_for(&self, label: &str) -> Vec<PickedFolder> {
        let own = self.window_launch.lock().unwrap_or_else(|p| p.into_inner()).remove(label);
        match own.and_then(|path| canonical(&path).ok()).filter(|path| path.is_dir()) {
            Some(path) => vec![self.grant_folder(&path)],
            None => self.take_launch_paths(),
        }
    }

    // MARK: - repos

    pub fn get(&self, id: &str) -> Result<Arc<RepoEntry>> {
        self.repos
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("Repo `{id}` chưa được mở")))
    }

    pub fn insert(&self, entry: RepoEntry) -> Arc<RepoEntry> {
        let entry = Arc::new(entry);
        self.repos.write().unwrap_or_else(|p| p.into_inner()).insert(entry.id.clone(), entry.clone());
        entry
    }

    /// Record the command-running key set that was just handed to the webview for display.
    pub fn set_reported(&self, repo_id: &str, findings_hash: &str) {
        self.reported.lock().unwrap_or_else(|p| p.into_inner()).insert(repo_id.to_string(), findings_hash.to_string());
    }

    pub fn reported(&self, repo_id: &str) -> Option<String> {
        self.reported.lock().unwrap_or_else(|p| p.into_inner()).get(repo_id).cloned()
    }

    // MARK: - recent

    pub fn recent_list(&self) -> Vec<RecentRepo> {
        self.recent.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    pub fn recent_path(&self, id: &str) -> Option<PathBuf> {
        self.recent.lock().unwrap_or_else(|p| p.into_inner()).iter().find(|r| r.id == id).map(|r| PathBuf::from(&r.path))
    }

    pub fn touch_recent(&self, root: &Path) {
        let item = RecentRepo { id: repo_id_for(root), name: folder_name(root), path: root.to_string_lossy().into_owned(), last_opened: now_ms() };
        let snapshot = {
            let mut recent = self.recent.lock().unwrap_or_else(|p| p.into_inner());
            recent.retain(|r| r.id != item.id);
            recent.insert(0, item);
            recent.truncate(MAX_RECENT);
            recent.clone()
        };
        // Failing to write the recent list must not break opening the repo.
        let _ = store::write_json(&self.recent_path, &RecentFile { items: snapshot });
    }

    pub fn forget_recent(&self, id: &str) {
        let snapshot = {
            let mut recent = self.recent.lock().unwrap_or_else(|p| p.into_inner());
            recent.retain(|r| r.id != id);
            recent.clone()
        };
        let _ = store::write_json(&self.recent_path, &RecentFile { items: snapshot });
    }

    /// Build an entry from the scan result; the trust state comes from `TrustStore`.
    #[allow(clippy::too_many_arguments)]
    pub fn build_entry(
        &self,
        root: PathBuf,
        git_dir: PathBuf,
        common_dir: PathBuf,
        entries: Vec<ConfigEntry>,
        hooks: &[trust::HookFile],
        empty_hooks: &Path,
        force_trusted: bool,
        fingerprint: ConfigFingerprint,
    ) -> RepoEntry {
        let findings = trust::find_findings(&entries, hooks);
        let findings_hash = trust::findings_hash(&entries, hooks);
        let trusted = force_trusted || findings.is_empty() || self.trust.is_trusted(&path_key(&root), &findings_hash);
        let restrictions = (!trusted).then(|| trust::build_restrictions(&entries, empty_hooks));
        RepoEntry {
            id: repo_id_for(&root),
            common_key: path_key(&common_dir),
            root,
            git_dir,
            common_dir,
            trusted,
            findings,
            findings_hash,
            entries,
            restrictions,
            fingerprint,
        }
    }

    pub fn is_inside(&self, path: &Path, root: &Path) -> bool {
        relative_to(path, root).is_some()
    }
}

/// A separate flag marking "detached from the webview" for an op's Channel.
pub fn new_detach_flag() -> Arc<AtomicBool> {
    Arc::new(AtomicBool::new(false))
}

pub fn is_detached(flag: &AtomicBool) -> bool {
    flag.load(Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_id_is_stable_and_opaque() {
        let a = repo_id_for(Path::new("/Users/a/repo"));
        assert_eq!(a, repo_id_for(Path::new("/Users/a/repo")));
        assert_ne!(a, repo_id_for(Path::new("/Users/a/repo2")));
        assert_eq!(a.len(), 16);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn grants_are_opaque_single_use_for_open_and_peekable_for_clone() {
        let dir = tempfile::tempdir().unwrap();
        let registry = Registry::new(dir.path());
        let picked = registry.grant_folder(dir.path());
        assert_eq!(registry.peek_grant(&picked.token).unwrap(), dir.path());
        assert_eq!(registry.peek_grant(&picked.token).unwrap(), dir.path(), "peek không huỷ");
        assert_eq!(registry.take_grant(&picked.token).unwrap(), dir.path());
        assert_eq!(registry.take_grant(&picked.token).unwrap_err().code(), "not-found");
        assert_eq!(registry.take_grant("không-có").unwrap_err().code(), "not-found");
        assert!(picked.token.len() >= 32, "token đủ dài để không đoán được");
    }

    #[test]
    fn recent_list_is_deduplicated_capped_and_persisted() {
        let dir = tempfile::tempdir().unwrap();
        let registry = Registry::new(dir.path());
        for index in 0..25 {
            registry.touch_recent(Path::new(&format!("/repos/r{index}")));
        }
        registry.touch_recent(Path::new("/repos/r3"));
        let list = registry.recent_list();
        assert_eq!(list.len(), MAX_RECENT);
        assert_eq!(list[0].path, "/repos/r3", "mới nhất lên đầu");
        assert_eq!(list.iter().filter(|r| r.path == "/repos/r3").count(), 1);
        let reloaded = Registry::new(dir.path());
        assert_eq!(reloaded.recent_list(), list);
        let id = list[1].id.clone();
        assert_eq!(reloaded.recent_path(&id), Some(PathBuf::from(&list[1].path)));
        reloaded.forget_recent(&id);
        assert!(reloaded.recent_path(&id).is_none());
    }

    #[test]
    fn launch_paths_become_tokens_once() {
        let dir = tempfile::tempdir().unwrap();
        let registry = Registry::new(dir.path());
        registry.push_launch_paths(vec![dir.path().to_path_buf(), dir.path().join("không-tồn-tại")]);
        let tokens = registry.take_launch_paths();
        assert_eq!(tokens.len(), 1, "đường dẫn không tồn tại bị bỏ");
        assert!(registry.take_launch_paths().is_empty());
    }

    #[test]
    fn fingerprint_detects_edits_missing_files_appearing_and_same_length_same_mtime_rewrites() {
        let dir = tempfile::tempdir().unwrap();
        let (config, include, missing) = (dir.path().join("config"), dir.path().join("seed.inc"), dir.path().join("missing.inc"));
        std::fs::write(&config, "aaaa").unwrap();
        std::fs::write(&include, "[x]\n").unwrap();
        let fingerprint = ConfigFingerprint::capture([config.clone(), include.clone(), missing.clone(), config.clone()]);
        assert_eq!(fingerprint.paths().count(), 3, "bỏ trùng");
        assert!(fingerprint.unchanged());
        // a file that did not exist at fingerprint time and appears later (e.g. a branch switch) → changed
        std::fs::write(&missing, "[filter \"x\"]\n").unwrap();
        assert!(!fingerprint.unchanged());
        std::fs::remove_file(&missing).unwrap();
        assert!(fingerprint.unchanged(), "xoá lại thì về như cũ");
        // an edit keeping the length, then mtime reset: only hashing the content detects it
        let before = std::fs::metadata(&config).unwrap().modified().unwrap();
        std::fs::write(&config, "bbbb").unwrap();
        std::fs::OpenOptions::new().write(true).open(&config).unwrap().set_modified(before).unwrap();
        assert!(!fingerprint.unchanged());
        std::fs::write(&config, "aaaa").unwrap();
        std::fs::OpenOptions::new().write(true).open(&config).unwrap().set_modified(before).unwrap();
        assert!(fingerprint.unchanged());
        // the file was deleted
        std::fs::remove_file(&include).unwrap();
        assert!(!fingerprint.unchanged());
    }

    #[test]
    fn fingerprint_consistency_and_volatility() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("config");
        std::fs::write(&file, "one").unwrap();
        let before = ConfigFingerprint::capture([file.clone()]);
        let steady = ConfigFingerprint::capture([file.clone(), dir.path().join("other")]);
        assert!(steady.consistent_with(&before));
        std::fs::write(&file, "two!").unwrap();
        let raced = ConfigFingerprint::capture([file.clone(), dir.path().join("other")]);
        assert!(!raced.consistent_with(&before), "file đổi giữa hai lần chụp");
        assert!(raced.unchanged());
        assert!(!raced.into_volatile().unchanged(), "volatile luôn bị coi là đã đổi");
        assert!(ConfigFingerprint::default().unchanged(), "vân tay rỗng (entry đã tin cậy) không bao giờ quét lại");
    }

    #[test]
    fn unknown_repo_id_is_not_found() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(Registry::new(dir.path()).get("abc").unwrap_err().code(), "not-found");
    }
}
