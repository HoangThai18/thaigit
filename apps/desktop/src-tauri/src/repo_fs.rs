//! RepoFs: byte-oriented reads/writes of repo files within the repo scope (no decoding: BOM, CRLF and Latin-1 survive).
//!
//! A relative path goes through `dunce::canonicalize` and must land inside the working-tree root (or the git dir, for
//! `fs_read_git_file`). Rejected: empty, NUL, absolute, a `..` segment, a symlink pointing outside, and EVERY path with a
//! `.git` segment (case-insensitive; including NTFS's `git~1` and a trailing `.` / space) so a single write cannot plant
//! `.git/hooks/*`.
//! The app's own trash lives in `<commonDir>/thaigit/trash/<token>/` (the `trash` crate is not used: it returns no location
//! and is not restorable on macOS).

use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::core::{Core, SpawnOptions};
use crate::errors::{AppError, Result};
use crate::exec::CancelToken;
use crate::locks::Holder;
use crate::pathutil::{
    canonical, check_relative_path, has_git_component, is_absolute_like, is_windows_reserved_name, path_has_git_component, relative_to,
};
use crate::policy::{EnvProfile, is_no_index_diff};
use crate::registry::RepoEntry;
use crate::trust::hex;

/// Default read limit when the caller does not set `maxBytes` (keeps huge files out of IPC).
pub const DEFAULT_MAX_READ: u64 = 64 * 1024 * 1024;
/// Git files readable through `fs_read_git_file` (other than `rebase-merge/*`, `rebase-apply/*`).
const GIT_FILES: [&str; 6] = ["MERGE_HEAD", "MERGE_MSG", "SQUASH_MSG", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG"];
const MAX_GIT_FILE: u64 = 8 * 1024 * 1024;
const MAX_GITIGNORE_LINE: usize = 4096;
/// The trash cleans itself up after this long.
pub const TRASH_RETENTION: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// The snapshot's temporary index, relative to the worktree's git dir — matching `indexFile` in `packages/contracts/snapshot.json`.
pub const SNAPSHOT_INDEX_REL: &str = "thaigit/snapshot.index";

fn out_of_scope(rel: &str, reason: &str) -> AppError {
    AppError::OutOfScope(format!("Đường dẫn `{rel}` bị từ chối: {reason}"))
}

/// Create `<gitDir>/thaigit/` (a real directory, not a symlink) and return the absolute path of the temporary index;
/// `reset` deletes exactly that index and its `.lock` file (a corrupt index, or an orphaned lock after the app was killed mid-`git add`).
fn prepare_snapshot_index(entry: &RepoEntry, reset: bool) -> Result<PathBuf> {
    let (dir_rel, file_name) = SNAPSHOT_INDEX_REL.split_once('/').expect("SNAPSHOT_INDEX_REL có dạng thư-mục/file");
    let dir = entry.git_dir.join(dir_rel);
    match std::fs::symlink_metadata(&dir) {
        Ok(meta) if meta.is_dir() => {}
        Ok(_) => return Err(out_of_scope(SNAPSHOT_INDEX_REL, "thư mục của index tạm không phải thư mục thật")),
        Err(_) => std::fs::create_dir_all(&dir).map_err(|e| AppError::io("Tạo thư mục index tạm", &e))?,
    }
    let resolved = canonical(&dir).map_err(|e| AppError::io("Thư mục index tạm", &e))?;
    if relative_to(&resolved, &entry.git_dir).is_none() {
        return Err(out_of_scope(SNAPSHOT_INDEX_REL, "nằm ngoài git dir"));
    }
    let index = resolved.join(file_name);
    if reset {
        for path in [index.clone(), resolved.join(format!("{file_name}.lock"))] {
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(AppError::io("Xoá index tạm", &error)),
            }
        }
    }
    Ok(index)
}

/// Validate a working-tree relative path before touching disk.
fn check_worktree_rel(rel: &str) -> Result<()> {
    if let Some(reason) = check_relative_path(rel, cfg!(windows)) {
        return Err(out_of_scope(rel, reason));
    }
    if has_git_component(rel) {
        return Err(out_of_scope(rel, "nằm trong .git"));
    }
    if cfg!(windows) && rel.split('/').any(is_windows_reserved_name) {
        return Err(out_of_scope(rel, "tên thiết bị của Windows"));
    }
    Ok(())
}

/// The real path (already `dunce::canonicalize`d) of `rel` in the working tree. For a file that does not exist: the parent
/// directory must exist and be inside the root. After symlink resolution it must still be inside the root AND must not go
/// through `.git` (e.g. a symlink `docs → .git`).
pub fn resolve_worktree(entry: &RepoEntry, rel: &str) -> Result<PathBuf> {
    check_worktree_rel(rel)?;
    let joined = entry.root.join(rel);
    let resolved = match std::fs::symlink_metadata(&joined) {
        Ok(_) => canonical(&joined).map_err(|e| out_of_scope(rel, &format!("không giải được liên kết ({e})")))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = joined.parent().ok_or_else(|| out_of_scope(rel, "không có thư mục cha"))?;
            let name = joined.file_name().ok_or_else(|| out_of_scope(rel, "không có tên file"))?;
            let parent = canonical(parent).map_err(|e| AppError::io("Thư mục cha", &e))?;
            parent.join(name)
        }
        Err(error) => return Err(AppError::io("Truy cập file", &error)),
    };
    let Some(remainder) = relative_to(&resolved, &entry.root) else {
        return Err(out_of_scope(rel, "trỏ ra ngoài repo"));
    };
    if path_has_git_component(&remainder) {
        return Err(out_of_scope(rel, "giải ra bên trong .git"));
    }
    Ok(resolved)
}

/// The path of the entry `rel` ITSELF (not followed when it is a symlink) — used when moving to the trash. Parent directories
/// must be real (no symlink/junction anywhere, so `ls-files` checked by the given path matches the moved entry) and inside
/// the root; the last component is kept as-is. Unlike `resolve_worktree`: an untracked symlink pointing at an ALREADY TRACKED
/// file moves the symlink itself rather than the target.
fn resolve_worktree_entry(entry: &RepoEntry, rel: &str) -> Result<PathBuf> {
    check_worktree_rel(rel)?;
    let joined = entry.root.join(rel);
    let parent = joined.parent().ok_or_else(|| out_of_scope(rel, "không có thư mục cha"))?;
    let name = joined.file_name().ok_or_else(|| out_of_scope(rel, "không có tên file"))?;
    let resolved_parent = canonical(parent).map_err(|e| out_of_scope(rel, &format!("thư mục cha không giải được ({e})")))?;
    let Some(remainder) = relative_to(&resolved_parent, &entry.root) else {
        return Err(out_of_scope(rel, "trỏ ra ngoài repo"));
    };
    if path_has_git_component(&remainder) {
        return Err(out_of_scope(rel, "giải ra bên trong .git"));
    }
    // Do not compare the real path string with the given path (macOS's Unicode NFC/NFD normalisation makes them differ even
    // without symlinks); walk each parent directory and ask directly whether it is a symlink/junction.
    let mut probe = entry.root.clone();
    for component in Path::new(rel).parent().into_iter().flat_map(Path::components) {
        probe.push(component);
        if std::fs::symlink_metadata(&probe).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
            return Err(out_of_scope(rel, "đi qua một liên kết (symlink)"));
        }
    }
    Ok(resolved_parent.join(name))
}

/// `canonicalize` of the nearest existing ancestor (walking up until a real directory is found for a path that does not exist).
fn nearest_existing_canonical(path: &Path) -> std::io::Result<PathBuf> {
    let mut probe = path.to_path_buf();
    loop {
        match std::fs::symlink_metadata(&probe) {
            Ok(_) => return canonical(&probe),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if !probe.pop() {
                    return Err(error);
                }
            }
            Err(error) => return Err(error),
        }
    }
}

/// The OS directory separator (on Unix `\` is an ordinary filename character).
fn is_separator(c: char) -> bool {
    c == '/' || (cfg!(windows) && c == '\\')
}

/// One `git diff` path operand: every parent directory (after symlink resolution) must be inside the working tree. For
/// `--no-index` git also reads straight through the file system, so additionally: `.git` must not be touched, and a last
/// element that is a symlink to a DIRECTORY (which git `stat`s and follows when joining the directory with a file, or when
/// there is a trailing `/`) must also resolve inside the repo. A symlink to a FILE is fine because git only reads the
/// target string (`lstat`) — an untracked symlink pointing outside can still be diffed.
fn check_diff_operand(entry: &RepoEntry, operand: &str, no_index: bool) -> Result<()> {
    if operand.contains('\0') || is_absolute_like(operand) || operand.split(['/', '\\']).any(|segment| segment == "..") {
        return Err(out_of_scope(operand, "đường dẫn tuyệt đối, chứa `..` hoặc NUL"));
    }
    if no_index {
        if has_git_component(operand) {
            return Err(out_of_scope(operand, "nằm trong .git"));
        }
        if cfg!(windows) && operand.split(['/', '\\']).any(is_windows_reserved_name) {
            return Err(out_of_scope(operand, "tên thiết bị của Windows"));
        }
    }
    let trailing_separator = operand.ends_with(is_separator);
    let trimmed = operand.trim_end_matches(is_separator);
    if trimmed.is_empty() {
        return Ok(());
    }
    let joined = entry.root.join(trimmed);
    let parent = joined.parent().unwrap_or(&entry.root);
    let resolved_parent = nearest_existing_canonical(parent).map_err(|e| out_of_scope(operand, &format!("không giải được liên kết ({e})")))?;
    let Some(remainder) = relative_to(&resolved_parent, &entry.root) else {
        return Err(out_of_scope(operand, "đi qua liên kết trỏ ra ngoài repo"));
    };
    if no_index && path_has_git_component(&remainder) {
        return Err(out_of_scope(operand, "giải ra bên trong .git"));
    }
    if !no_index {
        return Ok(());
    }
    if let Ok(metadata) = std::fs::symlink_metadata(&joined)
        && metadata.file_type().is_symlink()
        && (trailing_separator || std::fs::metadata(&joined).is_ok_and(|target| target.is_dir()))
    {
        let resolved = canonical(&joined).map_err(|e| out_of_scope(operand, &format!("không giải được liên kết ({e})")))?;
        match relative_to(&resolved, &entry.root) {
            Some(rest) if !path_has_git_component(&rest) => {}
            _ => return Err(out_of_scope(operand, "liên kết tới thư mục nằm ngoài repo (hoặc trong .git)")),
        }
    }
    Ok(())
}

/// `git diff`: a path operand must be inside the working tree AFTER symlink resolution. A string check (`check_scope`) is not
/// enough: a symlink `linkdir → /` created by the repo itself (e.g. through `apply`) makes `diff --no-index -- base
/// linkdir/etc/passwd` read a file outside. Only path operands are checked (a revision such as `HEAD~3..HEAD` counts as a
/// non-existent path and passes); `/dev/null`, `-` (stdin) and `NUL` (Windows only) are exceptions.
pub fn check_diff_operands(entry: &RepoEntry, args: &[String]) -> Result<()> {
    let no_index = is_no_index_diff("diff", args);
    let mut after_double_dash = false;
    for arg in args {
        if !after_double_dash {
            if arg == "--" {
                after_double_dash = true;
                continue;
            }
            if arg.len() > 1 && arg.starts_with('-') {
                continue;
            }
        }
        // `-` = stdin and `/dev/null` are always special to git; `NUL` only on Windows (on Unix it is an ordinary filename — it
        // could be a symlink `NUL → /etc` used to join a directory with a file).
        if matches!(arg.as_str(), "-" | "/dev/null") || (cfg!(windows) && arg.eq_ignore_ascii_case("nul")) {
            continue;
        }
        check_diff_operand(entry, arg, no_index)?;
    }
    Ok(())
}

fn read_limited(path: &Path, max: u64, rel: &str) -> Result<Option<Vec<u8>>> {
    let metadata = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(AppError::io("Đọc file", &e)),
    };
    if !metadata.is_file() {
        return Err(AppError::Io(format!("`{rel}` không phải file thường")));
    }
    if metadata.len() > max {
        return Err(AppError::Io(format!("`{rel}` lớn hơn giới hạn đọc ({max} byte)")));
    }
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::io("Đọc file", &e)),
    }
}

/// `fs_read_git_file`: only the allowlisted names, inside the git dir. Missing → `None`.
pub fn read_git_file(entry: &RepoEntry, rel: &str) -> Result<Option<Vec<u8>>> {
    if let Some(reason) = check_relative_path(rel, false) {
        return Err(out_of_scope(rel, reason));
    }
    let allowed = GIT_FILES.contains(&rel) || {
        let mut parts = rel.split('/');
        matches!(parts.next(), Some("rebase-merge" | "rebase-apply")) && parts.next().is_some()
    };
    if !allowed {
        return Err(out_of_scope(rel, "không thuộc danh sách file git được đọc"));
    }
    let path = entry.git_dir.join(rel);
    let path = match std::fs::symlink_metadata(&path) {
        Ok(_) => canonical(&path).map_err(|e| out_of_scope(rel, &format!("không giải được liên kết ({e})")))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(AppError::io("Truy cập file git", &e)),
    };
    if relative_to(&path, &entry.git_dir).is_none() {
        return Err(out_of_scope(rel, "trỏ ra ngoài git dir"));
    }
    read_limited(&path, MAX_GIT_FILE, rel)
}

/// `fs_read_worktree_file`: missing → `None`; larger than `max_bytes` → error.
pub fn read_worktree_file(entry: &RepoEntry, rel: &str, max_bytes: Option<u64>) -> Result<Option<Vec<u8>>> {
    let path = resolve_worktree(entry, rel)?;
    read_limited(&path, max_bytes.unwrap_or(DEFAULT_MAX_READ).min(DEFAULT_MAX_READ), rel)
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

/// `fs_write_worktree_file`: CAS against the current content (`expected = None` → the file must not exist), writing a temp
/// file in the same directory and then renaming over it, preserving the file mode.
pub fn write_worktree_file(entry: &RepoEntry, rel: &str, bytes: &[u8], expected_sha256: Option<&str>) -> Result<()> {
    let path = resolve_worktree(entry, rel)?;
    let existing = match std::fs::metadata(&path) {
        Ok(m) if m.is_file() => Some(m),
        Ok(_) => return Err(AppError::Io(format!("`{rel}` không phải file thường"))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(AppError::io("Đọc file", &e)),
    };
    match (existing.as_ref(), expected_sha256) {
        (Some(_), Some(expected)) => {
            let current = std::fs::read(&path).map_err(|e| AppError::io("Đọc file hiện tại", &e))?;
            if !sha256_hex(&current).eq_ignore_ascii_case(expected.trim()) {
                return Err(AppError::Conflict(format!("`{rel}` đã bị sửa bên ngoài Thaigit")));
            }
        }
        (Some(_), None) => return Err(AppError::Conflict(format!("`{rel}` đã tồn tại"))),
        (None, Some(_)) => return Err(AppError::Conflict(format!("`{rel}` không còn tồn tại"))),
        (None, None) => {}
    }
    let dir = path.parent().ok_or_else(|| AppError::Internal("Thiếu thư mục cha".into()))?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let temp = dir.join(format!(".{name}.thaigit-{}.tmp", uuid::Uuid::new_v4().simple()));
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        if let Some(metadata) = &existing {
            std::fs::set_permissions(&temp, metadata.permissions())?;
        }
        std::fs::rename(&temp, &path)
    })();
    if let Err(error) = result {
        let _ = std::fs::remove_file(&temp);
        return Err(AppError::io("Ghi file", &error));
    }
    Ok(())
}

/// `fs_append_gitignore`: append one line byte-wise, following the existing line terminator style and adding a final terminator when missing.
pub fn append_gitignore(entry: &RepoEntry, line: &str) -> Result<()> {
    if line.is_empty() || line.len() > MAX_GITIGNORE_LINE || line.contains(['\n', '\r', '\0']) {
        return Err(AppError::policy("dòng .gitignore phải là một dòng không rỗng, không chứa ký tự xuống dòng/NUL"));
    }
    let path = resolve_worktree(entry, ".gitignore")?;
    let existing = read_limited(&path, DEFAULT_MAX_READ, ".gitignore")?.unwrap_or_default();
    let crlf = existing.iter().position(|b| *b == b'\n').is_some_and(|i| i > 0 && existing[i - 1] == b'\r');
    let eol: &[u8] = if crlf { b"\r\n" } else { b"\n" };
    let mut addition: Vec<u8> = Vec::new();
    if !existing.is_empty() && !existing.ends_with(b"\n") {
        addition.extend_from_slice(eol);
    }
    addition.extend_from_slice(line.as_bytes());
    addition.extend_from_slice(eol);
    let mut file = std::fs::OpenOptions::new().append(true).create(true).open(&path).map_err(|e| AppError::io("Mở .gitignore", &e))?;
    file.write_all(&addition).map_err(|e| AppError::io("Ghi .gitignore", &e))?;
    file.sync_all().map_err(|e| AppError::io("Ghi .gitignore", &e))
}

// --- thùng rác --------------------------------------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
struct TrashItem {
    rel: String,
    dir: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct TrashManifest {
    items: Vec<TrashItem>,
}

fn trash_root(entry: &RepoEntry) -> PathBuf {
    entry.common_dir.join("thaigit").join("trash")
}

fn valid_token(token: &str) -> bool {
    let mut parts = token.splitn(2, '-');
    let (Some(ts), Some(rand)) = (parts.next(), parts.next()) else { return false };
    !ts.is_empty() && ts.len() <= 16 && ts.bytes().all(|b| b.is_ascii_digit()) && rand.len() == 8 && rand.bytes().all(|b| b.is_ascii_hexdigit())
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    let metadata = std::fs::symlink_metadata(from)?;
    if metadata.is_dir() {
        std::fs::create_dir_all(to)?;
        for child in std::fs::read_dir(from)? {
            let child = child?;
            copy_tree(&child.path(), &to.join(child.file_name()))?;
        }
        std::fs::set_permissions(to, metadata.permissions())?;
        Ok(())
    } else if metadata.file_type().is_symlink() {
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(std::fs::read_link(from)?, to)
        }
        #[cfg(windows)]
        {
            let target = std::fs::read_link(from)?;
            if from.is_dir() { std::os::windows::fs::symlink_dir(target, to) } else { std::os::windows::fs::symlink_file(target, to) }
        }
    } else {
        std::fs::copy(from, to).map(|_| ())
    }
}

/// Move `from` → `to`: same volume → rename; different volume (or `force_copy` in tests) → copy, then delete the source.
fn move_path(from: &Path, to: &Path, force_copy: bool) -> std::io::Result<()> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if !force_copy {
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::CrossesDevices => {}
            Err(e) => return Err(e),
        }
    }
    copy_tree(from, to)?;
    if std::fs::symlink_metadata(from)?.is_dir() { std::fs::remove_dir_all(from) } else { std::fs::remove_file(from) }
}

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

/// Delete trash entries past their age (based on the timestamp in the token name).
pub fn cleanup_trash(entry: &RepoEntry, retention: Duration) {
    let Ok(dirs) = std::fs::read_dir(trash_root(entry)) else { return };
    let cutoff = now_ms().saturating_sub(retention.as_millis());
    for dir in dirs.filter_map(|d| d.ok()) {
        let name = dir.file_name().to_string_lossy().into_owned();
        if !valid_token(&name) {
            continue;
        }
        let stamp: u128 = name.split('-').next().and_then(|t| t.parse().ok()).unwrap_or(u128::MAX);
        if stamp < cutoff {
            let _ = std::fs::remove_dir_all(dir.path());
        }
    }
}

fn trash_rels(entry: &RepoEntry, rels: &[String], force_copy: bool) -> Result<String> {
    if rels.is_empty() {
        return Err(AppError::policy("không có file nào để dời vào thùng rác"));
    }
    let mut sources: Vec<(String, PathBuf, bool)> = Vec::new();
    for rel in rels {
        let path = resolve_worktree_entry(entry, rel)?;
        let metadata = std::fs::symlink_metadata(&path).map_err(|e| AppError::io(&format!("`{rel}`"), &e))?;
        if path == entry.root {
            return Err(out_of_scope(rel, "không được dời cả thư mục gốc"));
        }
        sources.push((rel.clone(), path, metadata.is_dir()));
    }
    let token = format!("{}-{}", now_ms(), &uuid::Uuid::new_v4().simple().to_string()[..8]);
    let base = trash_root(entry).join(&token);
    let data = base.join("data");
    std::fs::create_dir_all(&data).map_err(|e| AppError::io("Tạo thùng rác", &e))?;
    let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
    for (rel, path, _) in &sources {
        let target = data.join(rel);
        if let Err(error) = move_path(path, &target, force_copy) {
            // Undo what was already moved, so no half-finished state is left behind.
            for (from, to) in moved.iter().rev() {
                let _ = move_path(to, from, force_copy);
            }
            let _ = std::fs::remove_dir_all(&base);
            return Err(AppError::io(&format!("Dời `{rel}` vào thùng rác"), &error));
        }
        moved.push((path.clone(), target));
    }
    let manifest = TrashManifest { items: sources.iter().map(|(rel, _, dir)| TrashItem { rel: rel.clone(), dir: *dir }).collect() };
    crate::store::write_json(&base.join("manifest.json"), &manifest)?;
    cleanup_trash(entry, TRASH_RETENTION);
    Ok(token)
}

fn restore_token(entry: &RepoEntry, token: &str, force_copy: bool) -> Result<()> {
    if !valid_token(token) {
        return Err(AppError::policy("mã thùng rác không hợp lệ"));
    }
    let base = trash_root(entry).join(token);
    let manifest: TrashManifest = crate::store::read_json(&base.join("manifest.json"))
        .ok_or_else(|| AppError::NotFound("Thùng rác này không còn (đã quá hạn hoặc đã khôi phục)".into()))?;
    let data = base.join("data");
    // Validate every destination before moving anything: overwrite nothing.
    let mut plan: Vec<(PathBuf, PathBuf)> = Vec::new();
    for item in &manifest.items {
        check_worktree_rel(&item.rel)?;
        let source = data.join(&item.rel);
        if std::fs::symlink_metadata(&source).is_err() {
            return Err(AppError::NotFound(format!("Thiếu `{}` trong thùng rác", item.rel)));
        }
        let target = entry.root.join(&item.rel);
        if std::fs::symlink_metadata(&target).is_ok() {
            return Err(AppError::Conflict(format!("`{}` đã tồn tại — không khôi phục đè lên", item.rel)));
        }
        // The parent directory may have been deleted meanwhile: recreate it, but it must still be in scope after symlink resolution.
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| AppError::io("Tạo lại thư mục cha", &e))?;
            let resolved = canonical(parent).map_err(|e| AppError::io("Thư mục cha", &e))?;
            match relative_to(&resolved, &entry.root) {
                Some(rest) if !path_has_git_component(&rest) => {}
                _ => return Err(out_of_scope(&item.rel, "thư mục cha trỏ ra ngoài repo")),
            }
        }
        plan.push((source, target));
    }
    for (source, target) in &plan {
        move_path(source, target, force_copy).map_err(|e| AppError::io("Khôi phục từ thùng rác", &e))?;
    }
    let _ = std::fs::remove_dir_all(&base);
    Ok(())
}

impl Core {
    /// `fs_trash_untracked`: move only UNTRACKED files/directories (verified with `git ls-files --cached`) into the app's trash.
    pub async fn trash_untracked(&self, repo_id: &str, rels: Vec<String>) -> Result<String> {
        self.trash_untracked_with(repo_id, rels, false).await
    }

    pub(crate) async fn trash_untracked_with(&self, repo_id: &str, rels: Vec<String>, force_copy: bool) -> Result<String> {
        let entry = self.registry.get(repo_id)?;
        // Check scope before running git, so a bad path reports a clear error.
        for rel in &rels {
            resolve_worktree_entry(&entry, rel)?;
        }
        let mut args: Vec<String> = vec!["--cached".into(), "-z".into(), "--".into()];
        args.extend(rels.iter().cloned());
        let mut caller_env = BTreeMap::new();
        caller_env.insert("GIT_LITERAL_PATHSPECS".to_string(), "1".to_string());
        let output = self
            .run_git(
                SpawnOptions {
                    cwd: &entry.root,
                    sub: "ls-files",
                    args: &args,
                    stdin: None,
                    profile: EnvProfile::Background,
                    caller_env,
                    restrictions: entry.restrictions.as_ref(),
                },
                Some(Duration::from_secs(60)),
            )
            .await?;
        if !output.ok() {
            return Err(AppError::Io(format!("Không kiểm tra được trạng thái track: {}", output.stderr().trim())));
        }
        if !output.collected.stdout.is_empty() {
            return Err(AppError::policy("chỉ dời được file chưa track vào thùng rác"));
        }
        let moved = entry.clone();
        tokio::task::spawn_blocking(move || trash_rels(&moved, &rels, force_copy))
            .await
            .map_err(|e| AppError::Internal(format!("Tác vụ nền lỗi: {e}")))?
    }

    /// `fs_snapshot_index_prepare`: hold the snapshot-style lock (`busy` when the repo is busy) so the temporary index is not
    /// deleted while another window is running `git add` into it.
    pub async fn snapshot_index_prepare(&self, repo_id: &str, reset: bool) -> Result<String> {
        let entry = self.registry.get(repo_id)?;
        let holder = Holder { op_id: "fs-snapshot-index".into(), background: false, cancel: CancelToken::new() };
        let _guard = self.locks.for_key(&entry.common_key).try_acquire_quiet(holder).map_err(AppError::from)?;
        let path = tokio::task::spawn_blocking(move || prepare_snapshot_index(&entry, reset))
            .await
            .map_err(|e| AppError::Internal(format!("Tác vụ nền lỗi: {e}")))??;
        Ok(path.to_string_lossy().into_owned())
    }

    pub async fn restore_trash(&self, repo_id: &str, token: String) -> Result<()> {
        let entry = self.registry.get(repo_id)?;
        // A restore can put a symlink back into the working tree, so it shares the exclusive lock with write commands: `diff
        // --no-index` (operand checked before git runs) holds the same lock, so nobody can slip a symlink in between the check and the read.
        let holder = Holder { op_id: format!("fs-restore-{token}"), background: false, cancel: CancelToken::new() };
        let _guard = self.locks.for_key(&entry.common_key).acquire(holder, None).await.map_err(AppError::from)?;
        tokio::task::spawn_blocking(move || restore_token(&entry, &token, false))
            .await
            .map_err(|e| AppError::Internal(format!("Tác vụ nền lỗi: {e}")))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::registry::Registry;
    use crate::testutil::{TestRepo, core_with, open};

    /// A fake entry pointing at a directory (no git needed) for scope / byte tests.
    fn entry_for(root: &Path) -> RepoEntry {
        let root = canonical(root).unwrap();
        let data = tempfile::tempdir().unwrap();
        Registry::new(data.path()).build_entry(
            root.clone(),
            root.join(".git"),
            root.join(".git"),
            vec![],
            &[],
            data.path(),
            true,
            crate::registry::ConfigFingerprint::default(),
        )
    }

    fn sandbox() -> (tempfile::TempDir, RepoEntry) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("repo/.git")).unwrap();
        let entry = entry_for(&dir.path().join("repo"));
        (dir, entry)
    }

    #[test]
    fn rejects_dotdot_absolute_and_malformed_paths() {
        let (dir, entry) = sandbox();
        std::fs::write(dir.path().join("secret.txt"), "s").unwrap();
        for bad in ["../secret.txt", "a/../../secret.txt", "/etc/passwd", "\\x", "C:\\x", "", "a\0b", "a//b", "./a", "a/"] {
            let error = read_worktree_file(&entry, bad, None).unwrap_err();
            assert_eq!(error.code(), "out-of-scope", "{bad:?}");
        }
        assert_eq!(write_worktree_file(&entry, "../evil", b"x", None).unwrap_err().code(), "out-of-scope");
        assert!(!dir.path().join("evil").exists());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_that_escape_the_repo_but_allows_inner_ones() {
        let (dir, entry) = sandbox();
        let root = entry.root.clone();
        std::fs::write(dir.path().join("secret.txt"), "TOP SECRET").unwrap();
        std::os::unix::fs::symlink(dir.path().join("secret.txt"), root.join("link-file")).unwrap();
        std::os::unix::fs::symlink(dir.path(), root.join("link-dir")).unwrap();
        std::fs::write(root.join("real.txt"), "ok").unwrap();
        std::os::unix::fs::symlink("real.txt", root.join("inner-link")).unwrap();
        std::os::unix::fs::symlink("missing-target", root.join("dangling")).unwrap();

        assert_eq!(read_worktree_file(&entry, "link-file", None).unwrap_err().code(), "out-of-scope");
        assert_eq!(read_worktree_file(&entry, "link-dir/secret.txt", None).unwrap_err().code(), "out-of-scope");
        assert_eq!(write_worktree_file(&entry, "link-dir/new.txt", b"x", None).unwrap_err().code(), "out-of-scope");
        assert!(!dir.path().join("new.txt").exists());
        assert_eq!(write_worktree_file(&entry, "link-file", b"x", Some(&sha256_hex(b"TOP SECRET"))).unwrap_err().code(), "out-of-scope");
        assert_eq!(std::fs::read(dir.path().join("secret.txt")).unwrap(), b"TOP SECRET");
        assert_eq!(read_worktree_file(&entry, "dangling", None).unwrap_err().code(), "out-of-scope");
        // A symlink inside the repo is readable (it resolves to a real file inside).
        assert_eq!(read_worktree_file(&entry, "inner-link", None).unwrap().unwrap(), b"ok");
    }

    #[cfg(unix)]
    #[test]
    fn symlink_into_dot_git_cannot_be_used_to_plant_hooks() {
        let (_dir, entry) = sandbox();
        let root = entry.root.clone();
        std::fs::create_dir_all(root.join(".git/hooks")).unwrap();
        std::os::unix::fs::symlink(root.join(".git"), root.join("docs")).unwrap();
        let error = write_worktree_file(&entry, "docs/hooks/pre-commit", b"#!/bin/sh\nevil\n", None).unwrap_err();
        assert_eq!(error.code(), "out-of-scope");
        assert!(!root.join(".git/hooks/pre-commit").exists());
        assert_eq!(read_worktree_file(&entry, "docs/hooks", None).unwrap_err().code(), "out-of-scope");
    }

    #[test]
    fn rejects_every_dot_git_spelling_for_read_write_and_trash() {
        let (_dir, entry) = sandbox();
        let root = entry.root.clone();
        std::fs::write(root.join(".git/config"), "[core]\n").unwrap();
        for bad in [
            ".git/hooks/pre-commit", ".git/config", ".GIT/config", ".Git/hooks/x", ".git./config", ".git /config", ".git. ./config",
            "sub/.git/config", "GIT~1/hooks/x", "git~1/config", "a/.git", ".git",
        ] {
            assert_eq!(read_worktree_file(&entry, bad, None).unwrap_err().code(), "out-of-scope", "đọc {bad:?}");
            assert_eq!(write_worktree_file(&entry, bad, b"x", None).unwrap_err().code(), "out-of-scope", "ghi {bad:?}");
        }
        assert!(!root.join(".git/hooks/pre-commit").exists());
        assert_eq!(std::fs::read(root.join(".git/config")).unwrap(), b"[core]\n");
        // A similar-looking name that is not `.git` still works.
        std::fs::write(root.join(".github"), "ok").unwrap();
        assert!(read_worktree_file(&entry, ".github", None).unwrap().is_some());
        assert!(read_worktree_file(&entry, ".gitignore", None).unwrap().is_none());
    }

    #[test]
    fn preserves_bom_crlf_and_latin1_bytes_exactly() {
        let (_dir, entry) = sandbox();
        let samples: [(&str, &[u8]); 4] = [
            ("bom.txt", b"\xEF\xBB\xBFxin ch\xC3\xA0o\r\nd\xC3\xB2ng hai\r\n"),
            ("crlf.txt", b"a\r\nb\r\n\r\nc"),
            ("latin1.txt", b"caf\xE9 \xFC\xDF \xA9 2024\n"),
            ("binary.bin", &[0, 1, 2, 0xFF, 0xFE, 0, b'\r', b'\n']),
        ];
        for (name, bytes) in samples {
            write_worktree_file(&entry, name, bytes, None).unwrap();
            assert_eq!(read_worktree_file(&entry, name, None).unwrap().unwrap(), bytes, "{name}");
            // Overwriting with exactly the content that was read still preserves the bytes.
            let current = read_worktree_file(&entry, name, None).unwrap().unwrap();
            write_worktree_file(&entry, name, &current, Some(&sha256_hex(&current))).unwrap();
            assert_eq!(std::fs::read(entry.root.join(name)).unwrap(), bytes);
        }
    }

    #[test]
    fn cas_write_detects_external_changes_and_creates_only_when_absent() {
        let (_dir, entry) = sandbox();
        write_worktree_file(&entry, "a.txt", b"v1", None).unwrap();
        // creating over an existing file → conflict
        assert_eq!(write_worktree_file(&entry, "a.txt", b"x", None).unwrap_err().code(), "conflict");
        // wrong hash → conflict, the file is unchanged
        assert_eq!(write_worktree_file(&entry, "a.txt", b"v2", Some(&sha256_hex("khác".as_bytes()))).unwrap_err().code(), "conflict");
        assert_eq!(std::fs::read(entry.root.join("a.txt")).unwrap(), b"v1");
        // right hash (case-insensitive) → write succeeds
        write_worktree_file(&entry, "a.txt", b"v2", Some(&sha256_hex(b"v1").to_uppercase())).unwrap();
        assert_eq!(std::fs::read(entry.root.join("a.txt")).unwrap(), b"v2");
        // the file was deleted externally → conflict
        std::fs::remove_file(entry.root.join("a.txt")).unwrap();
        assert_eq!(write_worktree_file(&entry, "a.txt", b"v3", Some(&sha256_hex(b"v2"))).unwrap_err().code(), "conflict");
        // the parent directory does not exist
        assert_eq!(write_worktree_file(&entry, "no/such/dir.txt", b"x", None).unwrap_err().code(), "not-found");
        // no temp file is left behind
        let leftovers: Vec<_> = std::fs::read_dir(&entry.root).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.contains("thaigit")).collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
    }

    #[cfg(unix)]
    #[test]
    fn write_keeps_the_file_mode() {
        use std::os::unix::fs::PermissionsExt;
        let (_dir, entry) = sandbox();
        write_worktree_file(&entry, "run.sh", b"#!/bin/sh\n", None).unwrap();
        std::fs::set_permissions(entry.root.join("run.sh"), std::fs::Permissions::from_mode(0o755)).unwrap();
        write_worktree_file(&entry, "run.sh", b"#!/bin/sh\necho 2\n", Some(&sha256_hex(b"#!/bin/sh\n"))).unwrap();
        assert_eq!(std::fs::metadata(entry.root.join("run.sh")).unwrap().permissions().mode() & 0o777, 0o755);
    }

    #[test]
    fn read_enforces_the_size_limit_and_reports_missing_as_none() {
        let (_dir, entry) = sandbox();
        write_worktree_file(&entry, "big.bin", &vec![7u8; 1000], None).unwrap();
        assert_eq!(read_worktree_file(&entry, "big.bin", Some(1000)).unwrap().unwrap().len(), 1000);
        assert_eq!(read_worktree_file(&entry, "big.bin", Some(999)).unwrap_err().code(), "io");
        assert_eq!(read_worktree_file(&entry, "missing.txt", None).unwrap(), None);
        std::fs::create_dir(entry.root.join("dir")).unwrap();
        assert_eq!(read_worktree_file(&entry, "dir", None).unwrap_err().code(), "io");
    }

    #[test]
    fn gitignore_append_keeps_bytes_and_line_endings() {
        let (_dir, entry) = sandbox();
        let path = entry.root.join(".gitignore");
        // no file yet → create with LF
        append_gitignore(&entry, "node_modules/").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"node_modules/\n");
        // a missing final terminator → one is added before appending
        std::fs::write(&path, b"a\nb").unwrap();
        append_gitignore(&entry, "c").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"a\nb\nc\n");
        // an existing CRLF style, with a BOM and non-UTF-8 bytes, is preserved
        std::fs::write(&path, b"\xEF\xBB\xBF*.log\r\n\xE9cache\r\nlast").unwrap();
        append_gitignore(&entry, "dist/").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"\xEF\xBB\xBF*.log\r\n\xE9cache\r\nlast\r\ndist/\r\n");
        // an empty file
        std::fs::write(&path, b"").unwrap();
        append_gitignore(&entry, "x").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"x\n");
        for bad in ["", "a\nb", "a\r", "a\0b"] {
            assert_eq!(append_gitignore(&entry, bad).unwrap_err().code(), "policy", "{bad:?}");
        }
        assert_eq!(std::fs::read(&path).unwrap(), b"x\n");
    }

    #[cfg(unix)]
    #[test]
    fn gitignore_symlink_to_outside_is_refused() {
        let (dir, entry) = sandbox();
        std::fs::write(dir.path().join("outside"), "keep\n").unwrap();
        std::os::unix::fs::symlink(dir.path().join("outside"), entry.root.join(".gitignore")).unwrap();
        assert_eq!(append_gitignore(&entry, "x").unwrap_err().code(), "out-of-scope");
        assert_eq!(std::fs::read(dir.path().join("outside")).unwrap(), b"keep\n");
    }

    #[test]
    fn git_files_are_limited_to_the_allowlist() {
        let (_dir, entry) = sandbox();
        let git = entry.git_dir.clone();
        std::fs::write(git.join("MERGE_HEAD"), "abc\n").unwrap();
        std::fs::write(git.join("MERGE_MSG"), "Merge branch\n").unwrap();
        std::fs::create_dir_all(git.join("rebase-merge")).unwrap();
        std::fs::write(git.join("rebase-merge/msgnum"), "3\n").unwrap();
        std::fs::write(git.join("config"), "[core]\n").unwrap();
        std::fs::write(git.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        assert_eq!(read_git_file(&entry, "MERGE_HEAD").unwrap().unwrap(), b"abc\n");
        assert_eq!(read_git_file(&entry, "MERGE_MSG").unwrap().unwrap(), b"Merge branch\n");
        assert_eq!(read_git_file(&entry, "rebase-merge/msgnum").unwrap().unwrap(), b"3\n");
        assert_eq!(read_git_file(&entry, "SQUASH_MSG").unwrap(), None);
        assert_eq!(read_git_file(&entry, "rebase-apply/next").unwrap(), None);
        for denied in ["config", "HEAD", "hooks/pre-commit", "../config", "rebase-merge", "rebase-merge/../config", "/etc/passwd", "refs/heads/main", "MERGE_HEAD/../config"] {
            assert_eq!(read_git_file(&entry, denied).unwrap_err().code(), "out-of-scope", "{denied}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn git_file_symlink_out_of_the_git_dir_is_refused() {
        let (dir, entry) = sandbox();
        std::fs::write(dir.path().join("secret"), "s").unwrap();
        std::os::unix::fs::symlink(dir.path().join("secret"), entry.git_dir.join("MERGE_MSG")).unwrap();
        assert_eq!(read_git_file(&entry, "MERGE_MSG").unwrap_err().code(), "out-of-scope");
    }

    #[tokio::test]
    async fn trash_moves_only_untracked_files_and_restores_them_exactly() {
        let repo = TestRepo::new();
        repo.write("tracked.txt", "t\n");
        repo.commit_all("init");
        repo.write_bytes("untracked.bin", b"\xEF\xBB\xBFbytes\r\n\xE9");
        repo.write("dir/a.txt", "a");
        repo.write("dir/sub/b.txt", "b");
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        let root = repo.canonical_root();

        let token = core.trash_untracked(&opened.repo_id, vec!["untracked.bin".into(), "dir".into()]).await.unwrap();
        assert!(!root.join("untracked.bin").exists());
        assert!(!root.join("dir").exists());
        assert!(root.join(".git/thaigit/trash").join(&token).join("data/untracked.bin").exists());
        assert!(repo.exists("tracked.txt"));

        core.restore_trash(&opened.repo_id, token.clone()).await.unwrap();
        assert_eq!(repo.read("untracked.bin"), b"\xEF\xBB\xBFbytes\r\n\xE9");
        assert_eq!(repo.read("dir/sub/b.txt"), b"b");
        assert!(!root.join(".git/thaigit/trash").join(&token).exists(), "thùng rác được dọn sau khi khôi phục");
        assert_eq!(core.restore_trash(&opened.repo_id, token).await.unwrap_err().code(), "not-found");
    }

    #[test]
    fn snapshot_index_path_matches_the_shared_spec() {
        let spec: serde_json::Value = serde_json::from_str(include_str!("../../../../packages/contracts/snapshot.json")).unwrap();
        assert_eq!(spec["indexFile"], SNAPSHOT_INDEX_REL);
    }

    #[tokio::test]
    async fn snapshot_index_prepare_creates_the_dir_and_reset_removes_only_the_index_and_its_lock() {
        let repo = TestRepo::new();
        repo.write("a.txt", "a");
        repo.commit_all("init");
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        let root = repo.canonical_root();
        let dir = root.join(".git/thaigit");
        assert!(!dir.exists());

        let path = core.snapshot_index_prepare(&opened.repo_id, false).await.unwrap();
        assert_eq!(PathBuf::from(&path), dir.join("snapshot.index"));
        assert!(dir.is_dir());

        std::fs::write(dir.join("snapshot.index"), "i").unwrap();
        std::fs::write(dir.join("snapshot.index.lock"), "l").unwrap();
        std::fs::write(dir.join("khac.txt"), "k").unwrap();
        core.snapshot_index_prepare(&opened.repo_id, false).await.unwrap();
        assert!(dir.join("snapshot.index").exists(), "không reset thì giữ nguyên index tạm");
        core.snapshot_index_prepare(&opened.repo_id, true).await.unwrap();
        assert!(!dir.join("snapshot.index").exists() && !dir.join("snapshot.index.lock").exists());
        assert!(dir.join("khac.txt").exists(), "chỉ xoá đúng index tạm và file khoá của nó");
        assert!(root.join(".git/index").exists(), "index thật không bị đụng tới");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn snapshot_index_prepare_refuses_a_symlinked_dir() {
        let repo = TestRepo::new();
        repo.write("a.txt", "a");
        repo.commit_all("init");
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), repo.canonical_root().join(".git/thaigit")).unwrap();
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        assert_eq!(core.snapshot_index_prepare(&opened.repo_id, true).await.unwrap_err().code(), "out-of-scope");
    }

    #[tokio::test]
    async fn trash_refuses_tracked_files_dot_git_and_escapes() {
        let repo = TestRepo::new();
        repo.write("tracked.txt", "t\n");
        repo.write("dir/tracked.txt", "t\n");
        repo.commit_all("init");
        repo.write("dir/new.txt", "n");
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        let id = &opened.repo_id;
        assert_eq!(core.trash_untracked(id, vec!["tracked.txt".into()]).await.unwrap_err().code(), "policy");
        // a directory containing tracked files is rejected too, and nothing is moved
        assert_eq!(core.trash_untracked(id, vec!["dir".into()]).await.unwrap_err().code(), "policy");
        assert!(repo.exists("dir/new.txt") && repo.exists("dir/tracked.txt"));
        for bad in [".git", ".git/hooks", "../x", "/etc/passwd", "GIT~1", ".git./config", ""] {
            assert_eq!(core.trash_untracked(id, vec![bad.into()]).await.unwrap_err().code(), "out-of-scope", "{bad:?}");
        }
        assert_eq!(core.trash_untracked(id, vec![]).await.unwrap_err().code(), "policy");
        assert_eq!(core.restore_trash(id, "../../etc".into()).await.unwrap_err().code(), "policy");
        assert_eq!(core.restore_trash(id, "123-zzzzzzzz".into()).await.unwrap_err().code(), "policy");
    }

    #[tokio::test]
    async fn restore_never_overwrites_and_is_all_or_nothing() {
        let repo = TestRepo::new();
        repo.write("seed.txt", "s");
        repo.commit_all("init");
        repo.write("one.txt", "1");
        repo.write("two.txt", "2");
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        let token = core.trash_untracked(&opened.repo_id, vec!["one.txt".into(), "two.txt".into()]).await.unwrap();
        repo.write("two.txt", "mới tạo lại");
        let error = core.restore_trash(&opened.repo_id, token.clone()).await.unwrap_err();
        assert_eq!(error.code(), "conflict");
        assert!(!repo.exists("one.txt"), "không khôi phục một nửa");
        assert_eq!(repo.read("two.txt"), "mới tạo lại".as_bytes());
        std::fs::remove_file(repo.root().join("two.txt")).unwrap();
        core.restore_trash(&opened.repo_id, token).await.unwrap();
        assert_eq!(repo.read("one.txt"), b"1");
        assert_eq!(repo.read("two.txt"), b"2");
    }

    #[tokio::test]
    async fn trash_falls_back_to_copy_and_delete_across_devices() {
        let repo = TestRepo::new();
        repo.write("seed.txt", "s");
        repo.commit_all("init");
        repo.write_bytes("f.bin", b"\x00\x01\xFF");
        repo.write("d/inner/x.txt", "x");
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        let token = core.trash_untracked_with(&opened.repo_id, vec!["f.bin".into(), "d".into()], true).await.unwrap();
        assert!(!repo.exists("f.bin") && !repo.exists("d"));
        core.restore_trash(&opened.repo_id, token).await.unwrap();
        assert_eq!(repo.read("f.bin"), b"\x00\x01\xFF");
        assert_eq!(repo.read("d/inner/x.txt"), b"x");
    }

    #[test]
    fn old_trash_is_cleaned_after_retention() {
        let (_dir, entry) = sandbox();
        let root = trash_root(&entry);
        let old = format!("{}-abcdef01", now_ms() - TRASH_RETENTION.as_millis() - 60_000);
        let fresh = format!("{}-abcdef02", now_ms());
        for name in [&old, &fresh, &"not-a-token".to_string()] {
            std::fs::create_dir_all(root.join(name).join("data")).unwrap();
        }
        cleanup_trash(&entry, TRASH_RETENTION);
        assert!(!root.join(&old).exists());
        assert!(root.join(&fresh).exists());
        assert!(root.join("not-a-token").exists(), "tên lạ không bị đụng tới");
    }

    #[test]
    fn token_format_is_strict() {
        for good in ["1700000000000-abcdef01", "1-00000000"] {
            assert!(valid_token(good), "{good}");
        }
        for bad in ["", "abc", "1700-xyz", "../1-abcdef01", "1-abcdef0", "1-abcdef012", "a-abcdef01", "1/2-abcdef01", "-abcdef01"] {
            assert!(!valid_token(bad), "{bad}");
        }
    }

    // --- L1: the trash only moves the SELECTED entry itself -----------------------------------------------------------------

    #[cfg(unix)]
    #[tokio::test]
    async fn trash_moves_an_untracked_symlink_itself_never_the_tracked_file_it_points_to() {
        let repo = TestRepo::new();
        repo.write("tracked.txt", "t\n");
        repo.write("dir/inner.txt", "i\n");
        repo.commit_all("init");
        std::os::unix::fs::symlink("tracked.txt", repo.root().join("link-to-tracked")).unwrap();
        std::os::unix::fs::symlink("dir", repo.root().join("link-to-dir")).unwrap();
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        let id = &opened.repo_id;

        // `ls-files` checks the given path (a symlink, untracked) while the old implementation canonicalised the destination: `tracked.txt` would be lost.
        let token = core.trash_untracked(id, vec!["link-to-tracked".into()]).await.unwrap();
        assert_eq!(repo.read("tracked.txt"), b"t\n", "file ĐÃ track không bị đụng tới");
        assert!(std::fs::symlink_metadata(repo.root().join("link-to-tracked")).is_err(), "chính symlink đã vào thùng rác");
        assert!(repo.git(&["status", "--porcelain"]).trim().is_empty() || !repo.git(&["status", "--porcelain"]).contains("tracked.txt"));
        core.restore_trash(id, token).await.unwrap();
        assert_eq!(std::fs::read_link(repo.root().join("link-to-tracked")).unwrap(), Path::new("tracked.txt"), "khôi phục vẫn là symlink");

        // a symlink to a TRACKED directory: only the symlink is moved
        let token = core.trash_untracked(id, vec!["link-to-dir".into()]).await.unwrap();
        assert_eq!(repo.read("dir/inner.txt"), b"i\n");
        assert!(std::fs::symlink_metadata(repo.root().join("link-to-dir")).is_err());
        core.restore_trash(id, token).await.unwrap();
        assert_eq!(std::fs::read_link(repo.root().join("link-to-dir")).unwrap(), Path::new("dir"));

        // going THROUGH a symlink is rejected (the target file is tracked)
        let error = core.trash_untracked(id, vec!["link-to-dir/inner.txt".into()]).await.unwrap_err();
        assert_eq!(error.code(), "out-of-scope", "{error}");
        assert_eq!(repo.read("dir/inner.txt"), b"i\n");
    }

    // --- H1: a `diff` operand must be inside the repo AFTER symlink resolution ----------------------------------------

    #[cfg(unix)]
    #[test]
    fn diff_operands_are_resolved_through_symlinks_before_the_scope_check() {
        let (dir, entry) = sandbox();
        let root = entry.root.clone();
        let outside = dir.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("passwd"), "SECRET").unwrap();
        std::fs::write(root.join("base"), "b").unwrap();
        std::fs::create_dir_all(root.join("sub/deeper")).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("linkdir")).unwrap();
        std::os::unix::fs::symlink(outside.join("passwd"), root.join("linkfile")).unwrap();
        std::os::unix::fs::symlink("sub", root.join("inner-dir-link")).unwrap();
        std::os::unix::fs::symlink(root.join(".git"), root.join("to-git")).unwrap();
        std::os::unix::fs::symlink("missing-target", root.join("dangling")).unwrap();
        // On Unix `NUL` is just a filename: a symlink `NUL → outside directory` is blocked too (joining the directory with the file `passwd`).
        std::fs::write(root.join("passwd"), "local").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("NUL")).unwrap();
        let check = |args: &[&str]| check_diff_operands(&entry, &args.iter().map(|a| a.to_string()).collect::<Vec<_>>()).map_err(|e| e.code());

        // going through a symlinked directory outside: blocked in both the normal mode and --no-index
        for args in [
            vec!["--no-index", "--", "base", "linkdir/passwd"],
            vec!["--", "linkdir/passwd"],
            vec!["linkdir/passwd"],
            vec!["--no-index", "--", "base", "linkdir/missing/x"],
            vec!["--no-index", "--", "base", "linkdir/../base"],
            vec!["--no-index", "--", "base", "/etc/passwd"],
            vec!["--no-index", "--", "base", "..\\x"],
        ] {
            assert_eq!(check(&args), Err("out-of-scope"), "{args:?}");
        }
        // --no-index: a symlink to an outside DIRECTORY (git joins the directory with a file) or a trailing `/`
        for args in [vec!["--no-index", "--", "passwd", "NUL"], vec!["--no-index", "--", "base", "linkdir"], vec!["--no-index", "--", "base", "linkdir/"], vec!["--no-index", "--", "base", "to-git"], vec!["--no-index", "--", "/dev/null", "to-git/config"]] {
            assert_eq!(check(&args), Err("out-of-scope"), "{args:?}");
        }
        // --no-index touching .git (any spelling) is blocked; the normal mode is not affected
        for args in [vec!["--no-index", "--", "/dev/null", ".git/config"], vec!["--no-index", "--", "/dev/null", ".GIT/config"], vec!["--no-index", "--", "/dev/null", "GIT~1/config"], vec!["--no-index", "--", "/dev/null", "sub/.git./x"]] {
            assert_eq!(check(&args), Err("out-of-scope"), "{args:?}");
        }
        // Valid use
        for args in [
            vec!["--no-index", "--", "/dev/null", "base"],
            vec!["--no-index", "--no-color", "-U3", "--", "/dev/null", "sub/deeper"],
            vec!["--no-index", "--", "base", "sub/not-yet-created.txt"],
            // a symlink to a FILE (git only reads the target string) and a dangling symlink: no content outside the repo is read
            vec!["--no-index", "--", "/dev/null", "linkfile"],
            vec!["--no-index", "--", "/dev/null", "dangling"],
            // a symlink to a directory INSIDE the repo
            vec!["--no-index", "--", "base", "inner-dir-link"],
            vec!["--no-index", "--", "base", "inner-dir-link/"],
            vec!["--no-index", "--", "base", "inner-dir-link/deeper"],
            // a normal diff: pathspec, revision, stdin
            vec!["--cached", "--", "base", "sub"],
            vec!["HEAD~3..HEAD", "--", "base"],
            vec!["origin/main", "HEAD"],
            vec!["--no-index", "--", "-", "base"],
            vec!["--", "linkfile"],
            vec!["--", "linkdir"],
        ] {
            assert_eq!(check(&args), Ok(()), "{args:?}");
        }
        // Only --no-index follows the last symlink: `diff -- linkdir` (a tracked symlink to an outside directory) works normally
        assert_eq!(check(&["--", "linkdir"]), Ok(()));
    }

    // Use a slow `#!/bin/sh` hook to hold the write lock: Unix only.
    #[cfg(unix)]
    #[tokio::test]
    async fn restore_trash_shares_the_write_lock_so_it_cannot_plant_a_symlink_mid_diff() {
        use crate::policy::ExecKind;
        use crate::testutil::{make_executable, request, run};
        let repo = TestRepo::new();
        repo.write("seed.txt", "s");
        repo.commit_all("init");
        repo.write("one.txt", "1");
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        core.trust_repo(&opened.repo_id).await.unwrap();
        let token = core.trash_untracked(&opened.repo_id, vec!["one.txt".into()]).await.unwrap();
        let hook = repo.root().join(".git/hooks/pre-commit");
        std::fs::write(&hook, "#!/bin/sh\nsleep 1\n").unwrap();
        make_executable(&hook);
        let writer = {
            let (core, id) = (core.clone(), opened.repo_id.clone());
            tokio::spawn(async move { run(&core, "main", request(&id, "writer", ExecKind::Write, "commit", &["--allow-empty", "-m", "w"])).await })
        };
        tokio::time::sleep(Duration::from_millis(300)).await;
        let started = std::time::Instant::now();
        core.restore_trash(&opened.repo_id, token).await.unwrap();
        assert!(started.elapsed() >= Duration::from_millis(450), "khôi phục phải chờ lệnh ghi đang chạy: {:?}", started.elapsed());
        assert_eq!(repo.read("one.txt"), b"1");
        writer.await.unwrap().0.unwrap();
    }
}
