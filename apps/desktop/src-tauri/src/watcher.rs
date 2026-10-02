//! Theo dõi thay đổi repo bằng `notify-debouncer-full`: một debounce thích nghi ở Rust (≥ 150 ms và ≥ thời gian `git status`
//! lần trước), phân loại đường dẫn (port `classifyGitPath` của `RepoWatcher.swift`), lọc gitignore bằng crate `ignore`
//! (`.gitignore` gốc, `info/exclude`, `core.excludesFile`; `.gitignore` lồng nhau nạp lười), tắt tiếng sự kiện khi chính app
//! đang chạy lệnh ghi/mạng trên repo, tràn bộ đệm → `rescan`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use ignore::Match;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify_debouncer_full::notify::{EventKind, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache, new_debouncer};
use serde::Serialize;

use crate::core::EventSink;
use crate::errors::{AppError, Result};
use crate::locks::RepoLock;
use crate::pathutil::{canonical, relative_to};

/// Debounce cơ sở; thời gian giữa hai lần phát còn không nhỏ hơn thời gian `git status` lần trước.
pub const BASE_DEBOUNCE: Duration = Duration::from_millis(150);
/// Sự kiện xảy ra trong lúc app chạy lệnh ghi/mạng (cộng khoảng ân hạn này) bị tắt tiếng: op tự làm mới khi xong.
pub const MUTE_GRACE: Duration = Duration::from_millis(500);
const MAX_CACHED_IGNORE_DIRS: usize = 4000;

/// Sự kiện `repo-changed` gửi webview (khớp `RepoChangedEvent`).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoChangedEvent {
    pub repo_id: String,
    /// `workingTree` | `refs` | `rescan`.
    pub kinds: Vec<&'static str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Change {
    pub working_tree: bool,
    pub refs: bool,
    pub rescan: bool,
}

impl Change {
    pub const NONE: Self = Self { working_tree: false, refs: false, rescan: false };
    pub const WORKING_TREE: Self = Self { working_tree: true, refs: false, rescan: false };
    pub const BOTH: Self = Self { working_tree: true, refs: true, rescan: false };
    pub const RESCAN: Self = Self { working_tree: false, refs: false, rescan: true };

    pub fn is_empty(self) -> bool {
        self == Self::NONE
    }

    pub fn union(self, other: Self) -> Self {
        Self { working_tree: self.working_tree || other.working_tree, refs: self.refs || other.refs, rescan: self.rescan || other.rescan }
    }

    pub fn kinds(self) -> Vec<&'static str> {
        let mut kinds = Vec::new();
        if self.working_tree {
            kinds.push("workingTree");
        }
        if self.refs {
            kinds.push("refs");
        }
        if self.rescan {
            kinds.push("rescan");
        }
        kinds
    }
}

/// Phân loại thay đổi bên trong thư mục `.git` (port nguyên `RepoWatcher.classifyGitPath`).
pub fn classify_git_path(relative: &str) -> Change {
    if relative.is_empty() {
        return Change::NONE;
    }
    const IGNORED_PREFIXES: [&str; 10] =
        ["objects/", "logs/", "lfs/", "hooks/", "info/", "modules/", "fsmonitor", "gc.", "FETCH_HEAD", "ORIG_HEAD.lock"];
    if IGNORED_PREFIXES.iter().any(|p| relative.starts_with(p)) || relative.ends_with(".lock") {
        return Change::NONE;
    }
    if relative == "index" {
        return Change::WORKING_TREE;
    }
    if relative == "HEAD"
        || relative == "packed-refs"
        || relative.starts_with("refs/")
        || relative.starts_with("rebase-")
        || relative.ends_with("_HEAD")
        || relative.starts_with("sequencer")
        || relative == "BISECT_LOG"
        || relative.starts_with("worktrees/")
    {
        return Change::BOTH;
    }
    Change::NONE
}

/// Bộ lọc gitignore: `.gitignore` gốc, `.gitignore` lồng nhau (nạp lười), `info/exclude`, `core.excludesFile`.
pub struct IgnoreSet {
    root: PathBuf,
    exclude_file: PathBuf,
    exclude: Mutex<Arc<Gitignore>>,
    global: Gitignore,
    dirs: Mutex<HashMap<PathBuf, Arc<Gitignore>>>,
}

fn build_matcher(root: &Path, files: &[PathBuf]) -> Gitignore {
    let mut builder = GitignoreBuilder::new(root);
    for file in files {
        // Lỗi cú pháp một dòng không làm mất cả file; file không có thì bỏ qua.
        let _ = builder.add(file);
    }
    builder.build().unwrap_or_else(|_| Gitignore::empty())
}

impl IgnoreSet {
    pub fn new(root: &Path, common_dir: &Path, global_excludes: Option<&Path>) -> Self {
        let exclude_file = common_dir.join("info").join("exclude");
        let global = global_excludes.map(|file| build_matcher(root, &[file.to_path_buf()])).unwrap_or_else(Gitignore::empty);
        Self {
            root: root.to_path_buf(),
            exclude: Mutex::new(Arc::new(build_matcher(root, std::slice::from_ref(&exclude_file)))),
            exclude_file,
            global,
            dirs: Mutex::new(HashMap::new()),
        }
    }

    /// `.gitignore` của thư mục `rel_dir` (tương đối với gốc; rỗng = gốc) thay đổi → nạp lại lần sau.
    pub fn invalidate_dir(&self, rel_dir: &Path) {
        self.dirs.lock().unwrap_or_else(|p| p.into_inner()).remove(rel_dir);
    }

    pub fn reload_exclude(&self) {
        *self.exclude.lock().unwrap_or_else(|p| p.into_inner()) = Arc::new(build_matcher(&self.root, std::slice::from_ref(&self.exclude_file)));
    }

    fn load_dir(&self, rel_dir: &Path) -> Arc<Gitignore> {
        let mut dirs = self.dirs.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(found) = dirs.get(rel_dir) {
            return found.clone();
        }
        if dirs.len() >= MAX_CACHED_IGNORE_DIRS {
            dirs.clear();
        }
        let dir = self.root.join(rel_dir);
        let matcher = Arc::new(build_matcher(&dir, &[dir.join(".gitignore")]));
        dirs.insert(rel_dir.to_path_buf(), matcher.clone());
        matcher
    }

    fn matched_one(&self, prefix: &Path, is_dir: bool) -> bool {
        let mut dir = prefix.parent().map(Path::to_path_buf).unwrap_or_default();
        loop {
            let local = prefix.strip_prefix(&dir).unwrap_or(prefix);
            match self.load_dir(&dir).matched(local, is_dir) {
                Match::Ignore(_) => return true,
                Match::Whitelist(_) => return false,
                Match::None => {}
            }
            if dir.as_os_str().is_empty() {
                break;
            }
            dir = dir.parent().map(Path::to_path_buf).unwrap_or_default();
        }
        let exclude = self.exclude.lock().unwrap_or_else(|p| p.into_inner()).clone();
        match exclude.matched(prefix, is_dir) {
            Match::Ignore(_) => return true,
            Match::Whitelist(_) => return false,
            Match::None => {}
        }
        matches!(self.global.matched(prefix, is_dir), Match::Ignore(_))
    }

    /// `rel` (tương đối với gốc) có bị bỏ qua không — hoặc nằm trong thư mục bị bỏ qua (git không cho "bỏ qua lại" con của thư mục bị loại).
    pub fn is_ignored(&self, rel: &Path, is_dir: bool) -> bool {
        let count = rel.components().count();
        let mut prefix = PathBuf::new();
        for (index, component) in rel.components().enumerate() {
            prefix.push(component);
            if self.matched_one(&prefix, index + 1 < count || is_dir) {
                return true;
            }
        }
        false
    }
}

/// Phân loại đường dẫn sự kiện theo repo.
pub struct Classifier {
    root: PathBuf,
    git_dir: PathBuf,
    common_dir: PathBuf,
    pub ignore: IgnoreSet,
}

impl Classifier {
    pub fn new(root: PathBuf, git_dir: PathBuf, common_dir: PathBuf, global_excludes: Option<&Path>) -> Self {
        let ignore = IgnoreSet::new(&root, &common_dir, global_excludes);
        Self { root, git_dir, common_dir, ignore }
    }

    pub fn classify(&self, path: &Path) -> Change {
        if let Some(relative) = relative_to(path, &self.git_dir).or_else(|| relative_to(path, &self.common_dir)) {
            let text = crate::pathutil::path_to_slash(&relative);
            if text == "info/exclude" {
                self.ignore.reload_exclude();
                return Change::WORKING_TREE;
            }
            return classify_git_path(&text);
        }
        let Some(relative) = relative_to(path, &self.root) else {
            return Change::NONE;
        };
        if relative.as_os_str().is_empty() {
            return Change::NONE;
        }
        // Siêu dữ liệu của repo lồng/submodule không phải thay đổi working tree của repo này.
        if crate::pathutil::path_has_git_component(&relative) {
            return Change::NONE;
        }
        let name = relative.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if name == ".gitignore" {
            self.ignore.invalidate_dir(relative.parent().unwrap_or(Path::new("")));
            return Change::WORKING_TREE;
        }
        let is_dir = std::fs::symlink_metadata(path).is_ok_and(|m| m.is_dir());
        if self.ignore.is_ignored(&relative, is_dir) { Change::NONE } else { Change::WORKING_TREE }
    }
}

pub struct WatchSpec {
    pub repo_id: String,
    pub root: PathBuf,
    pub git_dir: PathBuf,
    pub common_dir: PathBuf,
    pub global_excludes: Option<PathBuf>,
    /// Khoá theo repo: để tắt tiếng khi có op ghi/mạng và đọc thời gian `status`.
    pub lock: Arc<RepoLock>,
}

struct Pending {
    change: Change,
    next_allowed: Instant,
}

struct Shared {
    pending: Mutex<Pending>,
    wake: Condvar,
    stop: AtomicBool,
}

/// Watcher của một (cửa sổ, repo). Thả handle = dừng.
pub struct WatchHandle {
    debouncer: Option<Debouncer<RecommendedWatcher, RecommendedCache>>,
    shared: Arc<Shared>,
    flusher: Option<JoinHandle<()>>,
}

impl Drop for WatchHandle {
    fn drop(&mut self) {
        self.shared.stop.store(true, Ordering::SeqCst);
        self.shared.wake.notify_all();
        if let Some(debouncer) = self.debouncer.take() {
            debouncer.stop_nonblocking();
        }
        if let Some(flusher) = self.flusher.take() {
            let _ = flusher.join();
        }
    }
}

type Emit = Arc<dyn Fn(RepoChangedEvent) + Send + Sync>;

fn process_result(classifier: &Classifier, lock: &RepoLock, result: DebounceEventResult) -> Change {
    let events = match result {
        Ok(events) => events,
        // Tràn bộ đệm hoặc lỗi theo dõi: không biết đã mất gì → quét lại toàn bộ.
        Err(_) => return Change::RESCAN,
    };
    let mut total = Change::NONE;
    for event in events {
        if event.need_rescan() {
            total = total.union(Change::RESCAN);
            continue;
        }
        if matches!(event.kind, EventKind::Access(_)) {
            continue;
        }
        let muted = lock.is_muted_at(event.time, MUTE_GRACE);
        let mut change = Change::NONE;
        for path in &event.paths {
            change = change.union(classifier.classify(path));
        }
        if muted {
            change = Change { working_tree: false, refs: false, rescan: change.rescan };
        }
        total = total.union(change);
    }
    total
}

/// Bắt đầu theo dõi. Đường dẫn được chuẩn hoá `dunce` (realpath: `/tmp` → `/private/tmp`, tên 8.3 trên Windows) để khớp
/// đường dẫn mà FSEvents/ReadDirectoryChangesW báo về.
pub fn spawn_watch(spec: WatchSpec, emit: Emit) -> Result<WatchHandle> {
    let norm = |path: &Path| canonical(path).unwrap_or_else(|_| path.to_path_buf());
    let (root, git_dir, common_dir) = (norm(&spec.root), norm(&spec.git_dir), norm(&spec.common_dir));
    let classifier = Arc::new(Classifier::new(root.clone(), git_dir.clone(), common_dir.clone(), spec.global_excludes.as_deref()));
    let shared = Arc::new(Shared {
        pending: Mutex::new(Pending { change: Change::NONE, next_allowed: Instant::now() }),
        wake: Condvar::new(),
        stop: AtomicBool::new(false),
    });

    let handler_shared = shared.clone();
    let handler_lock = spec.lock.clone();
    let handler_classifier = classifier;
    let mut debouncer = new_debouncer(BASE_DEBOUNCE, None, move |result: DebounceEventResult| {
        let change = process_result(&handler_classifier, &handler_lock, result);
        if change.is_empty() {
            return;
        }
        let mut pending = handler_shared.pending.lock().unwrap_or_else(|p| p.into_inner());
        pending.change = pending.change.union(change);
        drop(pending);
        handler_shared.wake.notify_all();
    })
    .map_err(|e| AppError::Io(format!("Không bật được theo dõi file: {e}")))?;

    let mut paths = vec![root.clone()];
    for dir in [&git_dir, &common_dir] {
        if relative_to(dir, &root).is_none() && !paths.contains(dir) {
            paths.push(dir.clone());
        }
    }
    for path in &paths {
        debouncer.watch(path, RecursiveMode::Recursive).map_err(|e| AppError::Io(format!("Không theo dõi được {}: {e}", path.display())))?;
    }

    let flusher_shared = shared.clone();
    let lock = spec.lock;
    let repo_id = spec.repo_id;
    let flusher = std::thread::Builder::new()
        .name("thaigit-watch".into())
        .spawn(move || {
            let mut pending = flusher_shared.pending.lock().unwrap_or_else(|p| p.into_inner());
            loop {
                if flusher_shared.stop.load(Ordering::SeqCst) {
                    return;
                }
                let now = Instant::now();
                if pending.change.is_empty() {
                    pending = flusher_shared.wake.wait(pending).unwrap_or_else(|p| p.into_inner());
                    continue;
                }
                if now < pending.next_allowed {
                    let wait = pending.next_allowed - now;
                    pending = flusher_shared.wake.wait_timeout(pending, wait).unwrap_or_else(|p| p.into_inner()).0;
                    continue;
                }
                let change = std::mem::take(&mut pending.change);
                // Thích nghi: không phát dồn dập hơn thời gian `git status` lần trước (và không dưới 150 ms).
                let gap = BASE_DEBOUNCE.max(Duration::from_millis(lock.status_ms()));
                pending.next_allowed = Instant::now() + gap;
                drop(pending);
                emit(RepoChangedEvent { repo_id: repo_id.clone(), kinds: change.kinds() });
                pending = flusher_shared.pending.lock().unwrap_or_else(|p| p.into_inner());
            }
        })
        .map_err(|e| AppError::Internal(format!("Không tạo được luồng theo dõi: {e}")))?;

    Ok(WatchHandle { debouncer: Some(debouncer), shared, flusher: Some(flusher) })
}

impl crate::core::Core {
    /// `core.excludesFile` của người dùng (mở rộng `~`), hoặc vị trí mặc định của git nếu file đó có.
    async fn global_excludes_file(&self, entry: &crate::registry::RepoEntry) -> Option<PathBuf> {
        let output = self.git_plain(&entry.root, "config", &["--type=path", "--get", "core.excludesfile"], entry.restrictions.as_ref()).await.ok()?;
        let configured = output.stdout().trim().to_string();
        if output.ok() && !configured.is_empty() {
            return Some(PathBuf::from(configured));
        }
        let base = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .filter(|p| !p.as_os_str().is_empty())
            .or_else(|| std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(|h| PathBuf::from(h).join(".config")))?;
        let default = base.join("git").join("ignore");
        default.is_file().then_some(default)
    }

    /// `watch_repo`: bắt đầu theo dõi repo cho cửa sổ gọi (thay watcher cũ của cùng cửa sổ + repo).
    pub async fn watch_repo(&self, window: &str, repo_id: &str) -> Result<()> {
        let entry = self.registry.get(repo_id)?;
        let global_excludes = self.global_excludes_file(&entry).await;
        let spec = WatchSpec {
            repo_id: entry.id.clone(),
            root: entry.root.clone(),
            git_dir: entry.git_dir.clone(),
            common_dir: entry.common_dir.clone(),
            global_excludes,
            lock: self.locks.for_key(&entry.common_key),
        };
        self.watchers.start(window, spec)
    }
}

/// Các watcher đang chạy, gắn nhãn (cửa sổ, repo).
pub struct Watchers {
    map: Mutex<HashMap<(String, String), WatchHandle>>,
    events: Arc<dyn EventSink>,
}

impl Watchers {
    pub fn new(events: Arc<dyn EventSink>) -> Self {
        Self { map: Mutex::new(HashMap::new()), events }
    }

    pub fn start(&self, window: &str, spec: WatchSpec) -> Result<()> {
        let repo_id = spec.repo_id.clone();
        let events = self.events.clone();
        let label = window.to_string();
        let handle = spawn_watch(spec, Arc::new(move |event| events.repo_changed(&label, &event)))?;
        // Thay watcher cũ của cùng (cửa sổ, repo) nếu có.
        let replaced = self.map.lock().unwrap_or_else(|p| p.into_inner()).insert((window.to_string(), repo_id), handle);
        drop(replaced);
        Ok(())
    }

    pub fn stop(&self, window: &str, repo_id: &str) {
        let removed = self.map.lock().unwrap_or_else(|p| p.into_inner()).remove(&(window.to_string(), repo_id.to_string()));
        drop(removed);
    }

    pub fn remove_window(&self, window: &str) {
        let removed: Vec<WatchHandle> = {
            let mut map = self.map.lock().unwrap_or_else(|p| p.into_inner());
            let keys: Vec<_> = map.keys().filter(|(w, _)| w == window).cloned().collect();
            keys.into_iter().filter_map(|k| map.remove(&k)).collect()
        };
        drop(removed);
    }

    pub fn count(&self) -> usize {
        self.map.lock().unwrap_or_else(|p| p.into_inner()).len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::locks::{Holder, Locks};
    use crate::testutil::TestRepo;
    use notify_debouncer_full::DebouncedEvent;
    use notify_debouncer_full::notify::Event;
    use std::sync::mpsc;

    #[test]
    fn classify_git_path_ports_the_swift_table() {
        for (path, expected) in [
            ("", Change::NONE),
            ("objects/ab/cdef", Change::NONE),
            ("logs/HEAD", Change::NONE),
            ("hooks/pre-commit", Change::NONE),
            ("info/exclude", Change::NONE),
            ("modules/sub/HEAD", Change::NONE),
            ("lfs/tmp/x", Change::NONE),
            ("fsmonitor--daemon.ipc", Change::NONE),
            ("gc.pid", Change::NONE),
            ("gc.log", Change::NONE),
            ("FETCH_HEAD", Change::NONE),
            ("ORIG_HEAD.lock", Change::NONE),
            ("index.lock", Change::NONE),
            ("HEAD.lock", Change::NONE),
            ("refs/heads/main.lock", Change::NONE),
            ("config", Change::NONE),
            ("COMMIT_EDITMSG", Change::NONE),
            ("index", Change::WORKING_TREE),
            ("HEAD", Change::BOTH),
            ("packed-refs", Change::BOTH),
            ("refs/heads/main", Change::BOTH),
            ("refs/remotes/origin/main", Change::BOTH),
            ("refs/tags/v1", Change::BOTH),
            ("rebase-merge/head-name", Change::BOTH),
            ("rebase-apply/next", Change::BOTH),
            ("MERGE_HEAD", Change::BOTH),
            ("CHERRY_PICK_HEAD", Change::BOTH),
            ("ORIG_HEAD", Change::BOTH),
            ("sequencer/todo", Change::BOTH),
            ("BISECT_LOG", Change::BOTH),
            ("worktrees/wt/HEAD", Change::BOTH),
        ] {
            assert_eq!(classify_git_path(path), expected, "{path:?}");
        }
    }

    fn ignore_set(root: &Path) -> IgnoreSet {
        IgnoreSet::new(root, &root.join(".git"), None)
    }

    #[test]
    fn gitignore_filtering_follows_git_precedence() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join(".git/info")).unwrap();
        std::fs::create_dir_all(root.join("sub/deep")).unwrap();
        std::fs::write(root.join(".gitignore"), "node_modules/\n*.log\ntarget\n!keep.log\nbuild/\n").unwrap();
        std::fs::write(root.join("sub/.gitignore"), "*.tmp\n!important.log\n/local-only.txt\n").unwrap();
        std::fs::write(root.join(".git/info/exclude"), "secret.txt\n").unwrap();
        let set = ignore_set(root);
        let ignored = |p: &str, d: bool| set.is_ignored(Path::new(p), d);
        assert!(ignored("node_modules", true));
        assert!(ignored("node_modules/pkg/index.js", false), "con của thư mục bị bỏ qua");
        assert!(ignored("a/b/c.log", false));
        assert!(!ignored("keep.log", false), "phủ định ở gốc");
        assert!(ignored("target/debug/x", false));
        assert!(ignored("build/out.js", false));
        assert!(!ignored("src/main.rs", false));
        assert!(!ignored("build", false), "`build/` chỉ khớp thư mục, không khớp file tên build");
        assert!(ignored("secret.txt", false), "info/exclude");
        // .gitignore lồng nhau (nạp lười), ưu tiên của thư mục sâu hơn
        assert!(ignored("sub/x.tmp", false));
        assert!(ignored("sub/deep/y.tmp", false));
        assert!(!ignored("x.tmp", false), "quy tắc trong sub/ không áp cho gốc");
        assert!(!ignored("sub/important.log", false), "phủ định ở thư mục sâu thắng quy tắc ở gốc");
        assert!(ignored("sub/local-only.txt", false));
        assert!(!ignored("sub/deep/local-only.txt", false), "`/local-only.txt` neo theo thư mục chứa .gitignore");
    }

    #[test]
    fn gitignore_changes_are_picked_up_after_invalidation() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        let set = ignore_set(root);
        assert!(!set.is_ignored(Path::new("dist/a.js"), false));
        std::fs::write(root.join(".gitignore"), "dist/\n").unwrap();
        assert!(!set.is_ignored(Path::new("dist/a.js"), false), "đang dùng bản cache cũ");
        set.invalidate_dir(Path::new(""));
        assert!(set.is_ignored(Path::new("dist/a.js"), false));
    }

    #[test]
    fn classifier_handles_git_dir_working_tree_and_outside_paths() {
        let dir = tempfile::tempdir().unwrap();
        let root = canonical(dir.path()).unwrap();
        std::fs::create_dir_all(root.join(".git/refs/heads")).unwrap();
        std::fs::write(root.join(".gitignore"), "node_modules/\n").unwrap();
        let classifier = Classifier::new(root.clone(), root.join(".git"), root.join(".git"), None);
        assert_eq!(classifier.classify(&root.join("src/a.rs")), Change::WORKING_TREE);
        assert_eq!(classifier.classify(&root.join(".git/index")), Change::WORKING_TREE);
        assert_eq!(classifier.classify(&root.join(".git/refs/heads/main")), Change::BOTH);
        assert_eq!(classifier.classify(&root.join(".git/objects/aa/bb")), Change::NONE);
        assert_eq!(classifier.classify(&root.join(".git/index.lock")), Change::NONE);
        assert_eq!(classifier.classify(&root.join("node_modules/x/y.js")), Change::NONE);
        assert_eq!(classifier.classify(&root.join("sub/.git/HEAD")), Change::NONE, "repo lồng không tính");
        assert_eq!(classifier.classify(&root.join(".gitignore")), Change::WORKING_TREE);
        assert_eq!(classifier.classify(&root), Change::NONE);
        assert_eq!(classifier.classify(Path::new("/somewhere/else/file")), Change::NONE);
    }

    #[test]
    fn classifier_compares_prefixes_case_insensitively_on_default_volumes() {
        let dir = tempfile::tempdir().unwrap();
        let root = canonical(dir.path()).unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        let classifier = Classifier::new(root.clone(), root.join(".git"), root.join(".git"), None);
        let upper = PathBuf::from(root.to_string_lossy().to_uppercase()).join("src/x.rs");
        let expected = if crate::pathutil::CASE_INSENSITIVE_FS { Change::WORKING_TREE } else { Change::NONE };
        assert_eq!(classifier.classify(&upper), expected);
    }

    fn debounced(kind: EventKind, path: &Path, time: Instant) -> DebouncedEvent {
        DebouncedEvent { event: Event::new(kind).add_path(path.to_path_buf()), time }
    }

    #[test]
    fn overflow_and_errors_become_rescan_and_working_tree_events_are_muted_by_event_time() {
        let dir = tempfile::tempdir().unwrap();
        let root = canonical(dir.path()).unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        let classifier = Classifier::new(root.clone(), root.join(".git"), root.join(".git"), None);
        let lock = Locks::default().for_key("/muted");
        let file = root.join("a.txt");
        let kind = EventKind::Modify(notify_debouncer_full::notify::event::ModifyKind::Any);

        assert_eq!(process_result(&classifier, &lock, Err(vec![])), Change::RESCAN);
        let rescan_event = Event::new(EventKind::Other).set_flag(notify_debouncer_full::notify::event::Flag::Rescan);
        let flagged = DebouncedEvent { event: rescan_event, time: Instant::now() };
        assert_eq!(process_result(&classifier, &lock, Ok(vec![flagged])), Change::RESCAN);

        let before = Instant::now();
        assert_eq!(process_result(&classifier, &lock, Ok(vec![debounced(kind, &file, before)])), Change::WORKING_TREE);

        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let guard = rt.block_on(lock.acquire(Holder { op_id: "w".into(), background: false, cancel: crate::exec::CancelToken::new() }, None)).unwrap();
        let during = Instant::now();
        assert_eq!(process_result(&classifier, &lock, Ok(vec![debounced(kind, &file, during)])), Change::NONE, "tắt tiếng khi app đang ghi");
        let both = process_result(
            &classifier,
            &lock,
            Ok(vec![debounced(kind, &file, during), DebouncedEvent { event: Event::new(EventKind::Other).set_flag(notify_debouncer_full::notify::event::Flag::Rescan), time: during }]),
        );
        assert_eq!(both, Change::RESCAN, "rescan không bao giờ bị tắt tiếng");
        drop(guard);
        assert_eq!(
            process_result(&classifier, &lock, Ok(vec![debounced(kind, &file, during)])),
            Change::NONE,
            "sự kiện xảy ra lúc op chạy vẫn bị tắt dù tới trễ"
        );
        std::thread::sleep(MUTE_GRACE + Duration::from_millis(50));
        assert_eq!(process_result(&classifier, &lock, Ok(vec![debounced(kind, &file, Instant::now())])), Change::WORKING_TREE);
    }

    fn collect_events(spec_repo: &TestRepo, lock: Arc<RepoLock>, through_symlink: bool) -> (WatchHandle, mpsc::Receiver<RepoChangedEvent>) {
        let (tx, rx) = mpsc::channel();
        let root = if through_symlink { spec_repo.symlinked_root() } else { spec_repo.root().to_path_buf() };
        let git_dir = root.join(".git");
        let spec = WatchSpec { repo_id: "r1".into(), root, git_dir: git_dir.clone(), common_dir: git_dir, global_excludes: None, lock };
        let handle = spawn_watch(spec, Arc::new(move |event| {
            let _ = tx.send(event);
        }))
        .unwrap();
        std::thread::sleep(Duration::from_millis(400));
        (handle, rx)
    }

    fn wait_for(rx: &mpsc::Receiver<RepoChangedEvent>, kind: &str, secs: u64) -> bool {
        let deadline = Instant::now() + Duration::from_secs(secs);
        while let Some(left) = deadline.checked_duration_since(Instant::now()) {
            match rx.recv_timeout(left) {
                Ok(event) if event.kinds.contains(&kind) => return true,
                Ok(_) => {}
                Err(_) => return false,
            }
        }
        false
    }

    fn drain(rx: &mpsc::Receiver<RepoChangedEvent>) {
        while rx.recv_timeout(Duration::from_millis(900)).is_ok() {}
    }

    #[test]
    fn reports_changes_for_a_repo_opened_through_a_symlinked_path() {
        let repo = TestRepo::new();
        let lock = Locks::default().for_key("/sym");
        let (_handle, rx) = collect_events(&repo, lock, true);
        let started = Instant::now();
        repo.write("ghi-chu.txt", "xin chào\n");
        assert!(wait_for(&rx, "workingTree", 5), "phải thấy sự kiện working tree qua đường dẫn symlink (/var → /private/var)");
        assert!(started.elapsed() < Duration::from_millis(2500), "sự kiện tới UI nhanh: {:?}", started.elapsed());
        repo.git(&["add", "ghi-chu.txt"]);
        repo.git(&["commit", "-qm", "Thêm ghi chú"]);
        assert!(wait_for(&rx, "refs", 5), "commit phải sinh sự kiện refs");
    }

    #[test]
    fn ignored_directories_do_not_cause_refresh_storms() {
        let repo = TestRepo::new();
        repo.write(".gitignore", "node_modules/\ntarget/\n");
        let lock = Locks::default().for_key("/ign");
        let (_handle, rx) = collect_events(&repo, lock, false);
        drain(&rx);
        for index in 0..50 {
            repo.write(&format!("node_modules/pkg{index}/index.js"), "x");
        }
        repo.write("target/debug/out.o", "x");
        assert!(rx.recv_timeout(Duration::from_millis(1500)).is_err(), "npm install / build không được gây làm mới");
        repo.write("src/real.rs", "fn main() {}\n");
        assert!(wait_for(&rx, "workingTree", 5));
    }

    #[test]
    fn working_tree_events_are_muted_while_the_app_runs_a_write_op() {
        let repo = TestRepo::new();
        let lock = Locks::default().for_key("/mute");
        let (_handle, rx) = collect_events(&repo, lock.clone(), false);
        drain(&rx);
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let guard = rt.block_on(lock.acquire(Holder { op_id: "w".into(), background: false, cancel: crate::exec::CancelToken::new() }, None)).unwrap();
        repo.write("during.txt", "x");
        std::thread::sleep(Duration::from_millis(700));
        drop(guard);
        assert!(rx.recv_timeout(Duration::from_millis(1500)).is_err(), "không phát sự kiện cho thay đổi do chính app gây ra");
        std::thread::sleep(MUTE_GRACE + Duration::from_millis(200));
        repo.write("after.txt", "x");
        assert!(wait_for(&rx, "workingTree", 5));
    }

    #[test]
    fn emission_is_rate_limited_by_the_last_status_duration() {
        let repo = TestRepo::new();
        let lock = Locks::default().for_key("/adaptive");
        lock.record_status_ms(1200);
        let (_handle, rx) = collect_events(&repo, lock, false);
        drain(&rx);
        repo.write("a.txt", "1");
        assert!(wait_for(&rx, "workingTree", 5));
        let first = Instant::now();
        repo.write("b.txt", "2");
        assert!(wait_for(&rx, "workingTree", 6));
        assert!(first.elapsed() >= Duration::from_millis(900), "lần phát thứ hai phải chờ ~thời gian status: {:?}", first.elapsed());
    }

    #[test]
    fn dropping_the_handle_stops_the_threads() {
        let repo = TestRepo::new();
        let lock = Locks::default().for_key("/drop");
        let (handle, rx) = collect_events(&repo, lock, false);
        drop(handle);
        repo.write("late.txt", "x");
        assert!(rx.recv_timeout(Duration::from_millis(1000)).is_err());
    }
}
