//! Sức khoẻ repo sau khi git bị giết giữa chừng: khoá mồ côi (`index.lock`, `HEAD.lock`, `refs/**/*.lock`,
//! `packed-refs.lock`…) khi không còn tiến trình git nào của app trên repo, cộng trạng thái thao tác dở
//! (merge/rebase/cherry-pick/revert/am/bisect). Gỡ khoá chỉ sau khi người dùng xác nhận (`remove_stale_lock`).

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;

use crate::core::Core;
use crate::errors::{AppError, Result};
use crate::registry::RepoEntry;

/// Khoá trẻ hơn mức này có thể đang được một git bên ngoài (terminal) giữ — chưa coi là mồ côi.
pub const MIN_STALE_AGE: Duration = Duration::from_secs(2);
const MAX_REF_ENTRIES: usize = 100_000;
const MAX_REF_DEPTH: usize = 16;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LockFile {
    /// Đường dẫn tuyệt đối (hiển thị cho người dùng và là định danh cho `remove_stale_lock`).
    pub path: String,
    pub age_secs: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoHealth {
    /// Khoá nghi mồ côi: trống khi app còn lệnh git chạy trên repo.
    pub stale_locks: Vec<LockFile>,
    /// `merge` | `rebase` | `cherry-pick` | `revert` | `am` | `bisect`.
    pub operation: Option<&'static str>,
    /// App đang có lệnh git chạy/xếp hàng trên repo (không đánh giá khoá lúc này).
    pub busy: bool,
}

/// Thao tác dở dang (giống `GitRepository.operationState` của app Swift).
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

/// Mọi file khoá của repo kèm tuổi: `*.lock` ở gốc gitDir/commonDir, `refs/**/*.lock`.
pub fn scan_lock_files(git_dir: &Path, common_dir: &Path) -> Vec<(PathBuf, Duration)> {
    let mut paths = Vec::new();
    top_level_locks(git_dir, &mut paths);
    if common_dir != git_dir {
        top_level_locks(common_dir, &mut paths);
    }
    let mut budget = MAX_REF_ENTRIES;
    ref_locks(&common_dir.join("refs"), 0, &mut budget, &mut paths);
    let now = SystemTime::now();
    paths
        .into_iter()
        .filter_map(|path| {
            let modified = std::fs::symlink_metadata(&path).ok()?.modified().ok()?;
            Some((path, now.duration_since(modified).unwrap_or_default()))
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
                .filter(|(_, age)| *age >= MIN_STALE_AGE)
                .map(|(path, age)| LockFile { path: path.to_string_lossy().into_owned(), age_secs: age.as_secs() })
                .collect()
        };
        Ok(RepoHealth { stale_locks, operation: detect_operation(&entry.git_dir), busy })
    }

    /// Gỡ một khoá mồ côi do `repo_health` báo (người dùng đã xác nhận). Không bao giờ xoá đường dẫn ngoài danh sách đó.
    pub fn remove_stale_lock(&self, repo_id: &str, path: &str) -> Result<()> {
        let entry = self.registry.get(repo_id)?;
        if self.repo_busy(&entry) {
            return Err(AppError::Busy("Repo đang có lệnh git chạy — chưa gỡ khoá được".into()));
        }
        let found = scan_lock_files(&entry.git_dir, &entry.common_dir)
            .into_iter()
            .find(|(candidate, age)| *age >= MIN_STALE_AGE && candidate.to_string_lossy() == path);
        let Some((lock, _)) = found else {
            return Err(AppError::OutOfScope("Đây không phải khoá mồ côi do repo_health báo".into()));
        };
        std::fs::remove_file(&lock).map_err(|e| AppError::io("Gỡ file khoá", &e))
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
        let mut found: Vec<String> =
            scan_lock_files(git, git).into_iter().map(|(p, _)| p.strip_prefix(git).unwrap().to_string_lossy().into_owned()).collect();
        found.sort();
        assert_eq!(found, ["HEAD.lock", "config.lock", "index.lock", "packed-refs.lock", "refs/heads/feature/x.lock", "refs/heads/main.lock"]);
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

        // Khoá mới tạo có thể là git bên ngoài đang chạy → chưa báo.
        assert!(core.repo_health(&opened.repo_id).unwrap().stale_locks.is_empty());
        age_file(&lock, 30);
        let health = core.repo_health(&opened.repo_id).unwrap();
        assert_eq!(health.stale_locks.len(), 1);
        assert!(health.stale_locks[0].path.ends_with("index.lock"));
        assert!(health.stale_locks[0].age_secs >= 29);
        assert!(!health.busy);

        // Chỉ gỡ được khoá nằm trong danh sách; đường dẫn tuỳ ý bị từ chối.
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
