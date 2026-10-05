//! Repo health after git was killed mid-command: orphaned locks (`index.lock`, `HEAD.lock`, `refs/**/*.lock`,
//! `packed-refs.lock`…) when no app git process is left on the repo, plus the state of in-progress operations
//! (merge/rebase/cherry-pick/revert/am/bisect). A lock is only removed after the user confirms (`remove_stale_lock`).
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;

use crate::core::Core;
use crate::errors::{AppError, Result};
use crate::pathutil::relative_slash;
use crate::registry::RepoEntry;

/// A lock younger than this may be held by an outside git (a terminal) — not treated as orphaned yet.
pub const MIN_STALE_AGE: Duration = Duration::from_secs(2);
const MAX_REF_ENTRIES: usize = 100_000;
const MAX_REF_DEPTH: usize = 16;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LockFile {
    /// Absolute path in the host's format (it is the identifier for `remove_stale_lock`).
    pub path: String,
    /// Path relative to the git directory containing it (`index.lock`, `refs/heads/main.lock`) — for display; always
    /// uses `/` (including on Windows), like every other relative path crossing IPC.
    pub relative_path: String,
    pub age_secs: u64,
}

/// A lock file found in the repo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScannedLock {
    pub path: PathBuf,
    /// Relative to the git directory holding the lock, using `/`.
    pub relative: String,
    pub age: Duration,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoHealth {
    /// Suspected orphaned lock: empty while the app still has a git command running on the repo.
    pub stale_locks: Vec<LockFile>,
    /// `merge` | `rebase` | `cherry-pick` | `revert` | `am` | `bisect`.
    pub operation: Option<&'static str>,
    /// The app has a git command running/queued on the repo (locks are not assessed right now).
    pub busy: bool,
}

/// An in-progress operation (like the Swift app's `GitRepository.operationState`).
pub fn detect_operation(git_dir: &Path) -> Option<&'static str> {
    let exists = |name: &str| git_dir.join(name).exists();
    if exists("rebase-merge") {
        return Some("rebase");
    }
    if exists("rebase-apply") {
        return Some(if exists("rebase-apply/applying") { "am" } else { "rebase" });
    }
    if exists("MERGE_HEAD") {
        return Some("merge");
    }
    if exists("CHERRY_PICK_HEAD") {
        return Some("cherry-pick");
    }
    if exists("REVERT_HEAD") {
        return Some("revert");
    }
    if exists("BISECT_LOG") {
        return Some("bisect");
    }
    None
}

fn is_lock_name(name: &str) -> bool {
    name.ends_with(".lock") && name.len() > ".lock".len()
}

fn top_level_locks(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.filter_map(|e| e.ok()) {
        if is_lock_name(&entry.file_name().to_string_lossy()) && entry.file_type().is_ok_and(|t| t.is_file()) {
            out.push(entry.path());
        }
    }
}

fn ref_locks(dir: &Path, depth: usize, budget: &mut usize, out: &mut Vec<PathBuf>) {
    if depth > MAX_REF_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.filter_map(|e| e.ok()) {
        if *budget == 0 {
            return;
        }
        *budget -= 1;
        let Ok(file_type) = entry.file_type() else { continue };
        if file_type.is_dir() {
            ref_locks(&entry.path(), depth + 1, budget, out);
        } else if file_type.is_file() && is_lock_name(&entry.file_name().to_string_lossy()) {
            out.push(entry.path());
        }
    }
}

/// Every lock file in the repo with its age: `*.lock` at the gitDir/commonDir root, `refs/**/*.lock`.
pub fn scan_lock_files(git_dir: &Path, common_dir: &Path) -> Vec<ScannedLock> {
    // Each path carries its root directory, so the relative display path can be computed.
    let mut found: Vec<(PathBuf, &Path)> = Vec::new();
    let mut paths = Vec::new();
    top_level_locks(git_dir, &mut paths);
    found.extend(paths.drain(..).map(|path| (path, git_dir)));
    if common_dir != git_dir {
        top_level_locks(common_dir, &mut paths);
        found.extend(paths.drain(..).map(|path| (path, common_dir)));
    }
    let mut budget = MAX_REF_ENTRIES;
    ref_locks(&common_dir.join("refs"), 0, &mut budget, &mut paths);
    found.extend(paths.drain(..).map(|path| (path, common_dir)));
    let now = SystemTime::now();
    found
        .into_iter()
        .filter_map(|(path, base)| {
            let modified = std::fs::symlink_metadata(&path).ok()?.modified().ok()?;
            let relative = relative_slash(&path, base)?;
            Some(ScannedLock { age: now.duration_since(modified).unwrap_or_default(), relative, path })
        })
        .collect()
}

impl Core {
    fn repo_busy(&self, entry: &RepoEntry) -> bool {
        self.ops.has_repo_ops(&entry.common_key)
    }

    pub fn repo_health(&self, repo_id: &str) -> Result<RepoHealth> {
        let entry = self.registry.get(repo_id)?;
        let busy = self.repo_busy(&entry);
        let stale_locks = if busy {
            Vec::new()
        } else {
            scan_lock_files(&entry.git_dir, &entry.common_dir)
                .into_iter()
                .filter(|lock| lock.age >= MIN_STALE_AGE)
                .map(|lock| LockFile { path: lock.path.to_string_lossy().into_owned(), relative_path: lock.relative, age_secs: lock.age.as_secs() })
                .collect()
        };
        Ok(RepoHealth { stale_locks, operation: detect_operation(&entry.git_dir), busy })
    }

    /// Remove an orphaned lock reported by `repo_health` (the user confirmed). Never deletes a path outside that list.
    pub fn remove_stale_lock(&self, repo_id: &str, path: &str) -> Result<()> {
        let entry = self.registry.get(repo_id)?;
        if self.repo_busy(&entry) {
            return Err(AppError::Busy("Repo đang có lệnh git chạy — chưa gỡ khoá được".into()));
        }
        let found = scan_lock_files(&entry.git_dir, &entry.common_dir)
            .into_iter()
            .find(|lock| lock.age >= MIN_STALE_AGE && lock.path.to_string_lossy() == path);
        let Some(lock) = found else {
            return Err(AppError::OutOfScope("Đây không phải khoá mồ côi do repo_health báo".into()));
        };
        std::fs::remove_file(&lock.path).map_err(|e| AppError::io("Gỡ file khoá", &e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{TestRepo, core_with, open};

    fn age_file(path: &Path, secs: u64) {
        let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
        file.set_modified(SystemTime::now() - Duration::from_secs(secs)).unwrap();
    }

    #[test]
    fn detects_in_progress_operations_like_the_swift_app() {
        let dir = tempfile::tempdir().unwrap();
        let git = dir.path();
        assert_eq!(detect_operation(git), None);
        std::fs::write(git.join("MERGE_HEAD"), "x").unwrap();
        assert_eq!(detect_operation(git), Some("merge"));
        std::fs::create_dir(git.join("rebase-apply")).unwrap();
        assert_eq!(detect_operation(git), Some("rebase"));
        std::fs::write(git.join("rebase-apply/applying"), "").unwrap();
        assert_eq!(detect_operation(git), Some("am"));
        std::fs::create_dir(git.join("rebase-merge")).unwrap();
        assert_eq!(detect_operation(git), Some("rebase"), "rebase-merge thắng");
        std::fs::remove_dir_all(git.join("rebase-merge")).unwrap();
        std::fs::remove_dir_all(git.join("rebase-apply")).unwrap();
        std::fs::remove_file(git.join("MERGE_HEAD")).unwrap();
        for (file, expected) in [("CHERRY_PICK_HEAD", "cherry-pick"), ("REVERT_HEAD", "revert"), ("BISECT_LOG", "bisect")] {
            std::fs::write(git.join(file), "x").unwrap();
            assert_eq!(detect_operation(git), Some(expected));
            std::fs::remove_file(git.join(file)).unwrap();
        }
    }

    #[test]
    fn scans_top_level_and_ref_locks_but_not_unrelated_files() {
        let dir = tempfile::tempdir().unwrap();
        let git = dir.path();
        std::fs::create_dir_all(git.join("refs/heads/feature")).unwrap();
        for file in ["index.lock", "HEAD.lock", "packed-refs.lock", "config.lock", "refs/heads/main.lock", "refs/heads/feature/x.lock"] {
            std::fs::write(git.join(file), "").unwrap();
        }
        for file in ["index", "HEAD", "refs/heads/main", ".lock", "gc.pid", "objects.lock.d"] {
            let path = git.join(file);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(path, "").unwrap();
        }
        let locks = scan_lock_files(git, git);
        let mut found: Vec<String> = locks.iter().map(|lock| lock.relative.clone()).collect();
        found.sort();
        // The relative path returned to the UI always uses `/` (including on Windows, where `PathBuf` would use `\`)
        // and matches the corresponding absolute path
        assert_eq!(found, ["HEAD.lock", "config.lock", "index.lock", "packed-refs.lock", "refs/heads/feature/x.lock", "refs/heads/main.lock"]);
        assert!(locks.iter().all(|lock| lock.path.starts_with(git) && lock.path.is_file()));
    }

    #[test]
    fn linked_worktree_locks_are_relative_to_the_directory_that_holds_them() {
        let dir = tempfile::tempdir().unwrap();
        let common = dir.path().join("common");
        let git = common.join("worktrees").join("wt");
        std::fs::create_dir_all(&git).unwrap();
        std::fs::create_dir_all(common.join("refs").join("heads")).unwrap();
        for path in [git.join("index.lock"), common.join("config.lock"), common.join("refs").join("heads").join("main.lock")] {
            std::fs::write(path, "").unwrap();
        }
        let mut found: Vec<String> = scan_lock_files(&git, &common).into_iter().map(|lock| lock.relative).collect();
        found.sort();
        assert_eq!(found, ["config.lock", "index.lock", "refs/heads/main.lock"]);
    }

    #[tokio::test]
    async fn orphaned_lock_is_reported_with_age_and_removable_after_confirmation() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1");
        repo.commit_all("init");
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        let lock = repo.canonical_root().join(".git/index.lock");
        std::fs::write(&lock, "").unwrap();

        // A freshly created lock may be an outside git that is running → not reported yet.
        assert!(core.repo_health(&opened.repo_id).unwrap().stale_locks.is_empty());
        age_file(&lock, 30);
        let health = core.repo_health(&opened.repo_id).unwrap();
        assert_eq!(health.stale_locks.len(), 1);
        assert!(health.stale_locks[0].path.ends_with("index.lock"));
        assert_eq!(health.stale_locks[0].relative_path, "index.lock");
        assert!(health.stale_locks[0].age_secs >= 29);
        assert!(!health.busy);

        // Only locks from that list can be removed; an arbitrary path is rejected.
        let outside = repo.tmp().join("victim.lock");
        std::fs::write(&outside, "").unwrap();
        age_file(&outside, 30);
        assert_eq!(core.remove_stale_lock(&opened.repo_id, &outside.to_string_lossy()).unwrap_err().code(), "out-of-scope");
        assert!(outside.exists());
        assert_eq!(core.remove_stale_lock(&opened.repo_id, "/etc/passwd").unwrap_err().code(), "out-of-scope");

        core.remove_stale_lock(&opened.repo_id, &health.stale_locks[0].path).unwrap();
        assert!(!lock.exists());
        assert!(core.repo_health(&opened.repo_id).unwrap().stale_locks.is_empty());
    }

    #[tokio::test]
    async fn health_reports_in_progress_state() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1");
        repo.commit_all("init");
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        assert_eq!(core.repo_health(&opened.repo_id).unwrap().operation, None);
        std::fs::write(repo.canonical_root().join(".git/MERGE_HEAD"), "abc\n").unwrap();
        assert_eq!(core.repo_health(&opened.repo_id).unwrap().operation, Some("merge"));
    }
}
