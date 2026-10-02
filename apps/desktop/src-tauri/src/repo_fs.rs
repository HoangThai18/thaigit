//! RepoFs: đọc/ghi file của repo THEO BYTE trong phạm vi repo (không decode: BOM, CRLF, Latin-1 giữ nguyên).
//!
//! Đường dẫn tương đối → `dunce::canonicalize` → phải nằm trong gốc working tree (hoặc git dir với `fs_read_git_file`).
//! Từ chối: rỗng, NUL, tuyệt đối, đoạn `..`, symlink trỏ ra ngoài, và MỌI đường dẫn có đoạn `.git` (không phân biệt
//! hoa thường; kể cả `git~1` của NTFS và đuôi `.`/khoảng trắng) để một lần ghi không thể gieo `.git/hooks/*`.
//! Thùng rác riêng của app trong `<commonDir>/thaigit/trash/<token>/` (không dùng crate `trash`: không trả vị trí, không
//! khôi phục được trên macOS).

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

/// Giới hạn đọc mặc định khi caller không đặt `maxBytes` (tránh đẩy file khổng lồ qua IPC).
pub const DEFAULT_MAX_READ: u64 = 64 * 1024 * 1024;
/// File git đọc được qua `fs_read_git_file` (ngoài `rebase-merge/*`, `rebase-apply/*`).
const GIT_FILES: [&str; 6] = ["MERGE_HEAD", "MERGE_MSG", "SQUASH_MSG", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG"];
const MAX_GIT_FILE: u64 = 8 * 1024 * 1024;
const MAX_GITIGNORE_LINE: usize = 4096;
/// Thùng rác tự dọn sau chừng này.
pub const TRASH_RETENTION: Duration = Duration::from_secs(7 * 24 * 60 * 60);

fn out_of_scope(rel: &str, reason: &str) -> AppError {
    AppError::OutOfScope(format!("Đường dẫn `{rel}` bị từ chối: {reason}"))
}

/// Kiểm đường dẫn tương đối của working tree trước khi chạm đĩa.
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

/// Đường dẫn thật (đã `dunce::canonicalize`) của `rel` trong working tree. File chưa tồn tại: thư mục cha phải tồn tại
/// và nằm trong gốc. Sau khi giải symlink vẫn phải trong gốc VÀ không đi qua `.git` (vd. symlink `docs → .git`).
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

/// Đường dẫn của CHÍNH mục `rel` (không đi theo nếu nó là symlink) — dùng khi dời vào thùng rác. Các thư mục cha phải là thư mục
/// thật (không symlink/junction nào, để kiểm `ls-files` theo đường dẫn nhập đúng với mục bị dời) và nằm trong gốc; phần tử cuối
/// giữ nguyên. Khác `resolve_worktree`: symlink chưa track trỏ tới file ĐÃ track thì dời chính symlink chứ không dời file đích.
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
    // Không so chuỗi đường dẫn thật với đường dẫn nhập (chuẩn hoá Unicode NFC/NFD của macOS làm chúng khác nhau dù không có
    // symlink); duyệt từng thư mục cha và hỏi thẳng có phải symlink/junction không.
    let mut probe = entry.root.clone();
    for component in Path::new(rel).parent().into_iter().flat_map(Path::components) {
        probe.push(component);
        if std::fs::symlink_metadata(&probe).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
            return Err(out_of_scope(rel, "đi qua một liên kết (symlink)"));
        }
    }
    Ok(resolved_parent.join(name))
}

/// `canonicalize` của tổ tiên gần nhất còn tồn tại (đường dẫn chưa tồn tại thì lên dần tới khi gặp thư mục có thật).
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

/// Dấu phân tách thư mục của hệ điều hành (trên Unix `\` là ký tự tên file thường).
fn is_separator(c: char) -> bool {
    c == '/' || (cfg!(windows) && c == '\\')
}

/// Một toán hạng đường dẫn của `git diff`: mọi thư mục cha (đã giải symlink) phải nằm trong working tree. Riêng `--no-index`
/// git đi thẳng qua hệ thống file nên còn: không đụng `.git`, và phần tử cuối là symlink tới THƯ MỤC (git `stat`, đi theo, khi
/// ghép thư mục với file hay khi có dấu `/` cuối) cũng phải giải ra trong repo. Symlink tới file thì git chỉ đọc chuỗi đích
/// (`lstat`) nên cho qua — vẫn diff được symlink chưa track trỏ ra ngoài.
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

/// `git diff`: toán hạng đường dẫn phải ở trong working tree SAU KHI giải symlink. Kiểm tra theo chuỗi (`check_scope`) không đủ:
/// symlink `linkdir → /` do chính repo tạo ra (vd. qua `apply`) làm `diff --no-index -- base linkdir/etc/passwd` đọc file ngoài.
/// Chỉ toán hạng đường dẫn mới bị kiểm (revision như `HEAD~3..HEAD` coi là đường dẫn chưa tồn tại → cho qua); `/dev/null`,
/// `-` (stdin) và `NUL` (chỉ Windows) là ngoại lệ.
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
        // `-` = stdin và `/dev/null` luôn được git hiểu đặc biệt; `NUL` chỉ ở Windows (trên Unix nó là tên file thường — có thể là
        // symlink `NUL → /etc` để ghép thư mục với file).
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

/// `fs_read_git_file`: chỉ các tên trong danh sách cho phép, trong git dir. Không có → `None`.
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

/// `fs_read_worktree_file`: không có → `None`; lớn hơn `max_bytes` → lỗi.
pub fn read_worktree_file(entry: &RepoEntry, rel: &str, max_bytes: Option<u64>) -> Result<Option<Vec<u8>>> {
    let path = resolve_worktree(entry, rel)?;
    read_limited(&path, max_bytes.unwrap_or(DEFAULT_MAX_READ).min(DEFAULT_MAX_READ), rel)
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

/// `fs_write_worktree_file`: CAS với nội dung hiện tại (`expected = None` → file phải chưa tồn tại), ghi tạm cùng thư mục
/// rồi đổi tên đè, giữ quyền file.
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

/// `fs_append_gitignore`: thêm một dòng theo byte, theo kiểu xuống dòng sẵn có; thêm xuống dòng cuối nếu thiếu.
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

/// Dời `from` → `to`: cùng ổ → rename; khác ổ (hoặc `force_copy` trong test) → sao chép rồi xoá nguồn.
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

/// Xoá thùng rác quá hạn (theo mốc thời gian trong tên token).
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
            // Hoàn tác phần đã dời để không để lại trạng thái nửa vời.
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
    // Kiểm toàn bộ đích trước khi dời: không ghi đè bất cứ gì.
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
        // Thư mục cha có thể đã bị xoá: tạo lại, nhưng phải còn trong phạm vi sau khi giải symlink.
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
    /// `fs_trash_untracked`: chỉ file/thư mục CHƯA track (kiểm bằng `git ls-files --cached`) vào thùng rác của app.
    pub async fn trash_untracked(&self, repo_id: &str, rels: Vec<String>) -> Result<String> {
        self.trash_untracked_with(repo_id, rels, false).await
    }

    pub(crate) async fn trash_untracked_with(&self, repo_id: &str, rels: Vec<String>, force_copy: bool) -> Result<String> {
        let entry = self.registry.get(repo_id)?;
        // Kiểm phạm vi trước khi chạy git để lỗi đường dẫn có thông báo rõ.
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

    pub async fn restore_trash(&self, repo_id: &str, token: String) -> Result<()> {
        let entry = self.registry.get(repo_id)?;
        // Khôi phục có thể đặt lại một symlink vào working tree nên đi chung khoá độc quyền với lệnh ghi: `diff --no-index`
        // (kiểm toán hạng rồi mới chạy git) cũng giữ khoá này, nên không ai chen symlink vào giữa lúc kiểm và lúc đọc.
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

    /// Entry giả trỏ vào một thư mục (không cần git) để test phạm vi/byte.
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
        // Symlink nằm trong repo thì đọc được (giải ra file thật bên trong).
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
        // Tên gần giống nhưng không phải `.git` vẫn dùng được.
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
            // Ghi đè bằng đúng nội dung đọc được vẫn giữ nguyên byte.
            let current = read_worktree_file(&entry, name, None).unwrap().unwrap();
            write_worktree_file(&entry, name, &current, Some(&sha256_hex(&current))).unwrap();
            assert_eq!(std::fs::read(entry.root.join(name)).unwrap(), bytes);
        }
    }

    #[test]
    fn cas_write_detects_external_changes_and_creates_only_when_absent() {
        let (_dir, entry) = sandbox();
        write_worktree_file(&entry, "a.txt", b"v1", None).unwrap();
        // tạo mới trên file đã có → conflict
        assert_eq!(write_worktree_file(&entry, "a.txt", b"x", None).unwrap_err().code(), "conflict");
        // sai băm → conflict, file không đổi
        assert_eq!(write_worktree_file(&entry, "a.txt", b"v2", Some(&sha256_hex("khác".as_bytes()))).unwrap_err().code(), "conflict");
        assert_eq!(std::fs::read(entry.root.join("a.txt")).unwrap(), b"v1");
        // đúng băm (không phân biệt hoa/thường) → ghi được
        write_worktree_file(&entry, "a.txt", b"v2", Some(&sha256_hex(b"v1").to_uppercase())).unwrap();
        assert_eq!(std::fs::read(entry.root.join("a.txt")).unwrap(), b"v2");
        // file đã bị xoá bên ngoài → conflict
        std::fs::remove_file(entry.root.join("a.txt")).unwrap();
        assert_eq!(write_worktree_file(&entry, "a.txt", b"v3", Some(&sha256_hex(b"v2"))).unwrap_err().code(), "conflict");
        // thư mục cha không tồn tại
        assert_eq!(write_worktree_file(&entry, "no/such/dir.txt", b"x", None).unwrap_err().code(), "not-found");
        // không để lại file tạm
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
        // chưa có file → tạo, kiểu LF
        append_gitignore(&entry, "node_modules/").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"node_modules/\n");
        // thiếu xuống dòng cuối → thêm trước khi nối
        std::fs::write(&path, b"a\nb").unwrap();
        append_gitignore(&entry, "c").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"a\nb\nc\n");
        // kiểu CRLF sẵn có, kèm BOM và byte không phải UTF-8 giữ nguyên
        std::fs::write(&path, b"\xEF\xBB\xBF*.log\r\n\xE9cache\r\nlast").unwrap();
        append_gitignore(&entry, "dist/").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"\xEF\xBB\xBF*.log\r\n\xE9cache\r\nlast\r\ndist/\r\n");
        // tệp rỗng
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
        // thư mục có chứa file đã track cũng bị từ chối, và không có gì bị dời
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

    // --- L1: thùng rác chỉ dời CHÍNH mục được chọn ---------------------------------------------------------------------

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

        // `ls-files` kiểm đường dẫn nhập (symlink, chưa track) nhưng bản cũ dời đích đã canonicalize: mất `tracked.txt`.
        let token = core.trash_untracked(id, vec!["link-to-tracked".into()]).await.unwrap();
        assert_eq!(repo.read("tracked.txt"), b"t\n", "file ĐÃ track không bị đụng tới");
        assert!(std::fs::symlink_metadata(repo.root().join("link-to-tracked")).is_err(), "chính symlink đã vào thùng rác");
        assert!(repo.git(&["status", "--porcelain"]).trim().is_empty() || !repo.git(&["status", "--porcelain"]).contains("tracked.txt"));
        core.restore_trash(id, token).await.unwrap();
        assert_eq!(std::fs::read_link(repo.root().join("link-to-tracked")).unwrap(), Path::new("tracked.txt"), "khôi phục vẫn là symlink");

        // symlink tới THƯ MỤC đã track: cũng chỉ dời symlink
        let token = core.trash_untracked(id, vec!["link-to-dir".into()]).await.unwrap();
        assert_eq!(repo.read("dir/inner.txt"), b"i\n");
        assert!(std::fs::symlink_metadata(repo.root().join("link-to-dir")).is_err());
        core.restore_trash(id, token).await.unwrap();
        assert_eq!(std::fs::read_link(repo.root().join("link-to-dir")).unwrap(), Path::new("dir"));

        // đi QUA symlink thì từ chối (file đích là file đã track)
        let error = core.trash_untracked(id, vec!["link-to-dir/inner.txt".into()]).await.unwrap_err();
        assert_eq!(error.code(), "out-of-scope", "{error}");
        assert_eq!(repo.read("dir/inner.txt"), b"i\n");
    }

    // --- H1: toán hạng `diff` phải ở trong repo SAU KHI giải symlink --------------------------------------------------------

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
        // Trên Unix `NUL` chỉ là một tên file: symlink `NUL → thư mục ngoài` cũng bị chặn (ghép thư mục với file `passwd`).
        std::fs::write(root.join("passwd"), "local").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("NUL")).unwrap();
        let check = |args: &[&str]| check_diff_operands(&entry, &args.iter().map(|a| a.to_string()).collect::<Vec<_>>()).map_err(|e| e.code());

        // đi qua symlink thư mục ra ngoài: bị chặn ở cả chế độ thường lẫn --no-index
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
        // --no-index: symlink tới THƯ MỤC ngoài (git ghép thư mục với file) hoặc có dấu `/` cuối
        for args in [vec!["--no-index", "--", "passwd", "NUL"], vec!["--no-index", "--", "base", "linkdir"], vec!["--no-index", "--", "base", "linkdir/"], vec!["--no-index", "--", "base", "to-git"], vec!["--no-index", "--", "/dev/null", "to-git/config"]] {
            assert_eq!(check(&args), Err("out-of-scope"), "{args:?}");
        }
        // --no-index đụng .git (mọi cách viết) bị chặn; chế độ thường không dính tới
        for args in [vec!["--no-index", "--", "/dev/null", ".git/config"], vec!["--no-index", "--", "/dev/null", ".GIT/config"], vec!["--no-index", "--", "/dev/null", "GIT~1/config"], vec!["--no-index", "--", "/dev/null", "sub/.git./x"]] {
            assert_eq!(check(&args), Err("out-of-scope"), "{args:?}");
        }
        // Dùng hợp lệ
        for args in [
            vec!["--no-index", "--", "/dev/null", "base"],
            vec!["--no-index", "--no-color", "-U3", "--", "/dev/null", "sub/deeper"],
            vec!["--no-index", "--", "base", "sub/not-yet-created.txt"],
            // symlink tới FILE (git chỉ đọc chuỗi đích) và symlink dangling: không đọc nội dung ngoài repo
            vec!["--no-index", "--", "/dev/null", "linkfile"],
            vec!["--no-index", "--", "/dev/null", "dangling"],
            // symlink tới thư mục TRONG repo
            vec!["--no-index", "--", "base", "inner-dir-link"],
            vec!["--no-index", "--", "base", "inner-dir-link/"],
            vec!["--no-index", "--", "base", "inner-dir-link/deeper"],
            // diff thường: pathspec, revision, stdin
            vec!["--cached", "--", "base", "sub"],
            vec!["HEAD~3..HEAD", "--", "base"],
            vec!["origin/main", "HEAD"],
            vec!["--no-index", "--", "-", "base"],
            vec!["--", "linkfile"],
            vec!["--", "linkdir"],
        ] {
            assert_eq!(check(&args), Ok(()), "{args:?}");
        }
        // Chỉ chế độ --no-index mới đi theo symlink cuối: `diff -- linkdir` (symlink tới thư mục ngoài, đã track) bình thường
        assert_eq!(check(&["--", "linkdir"]), Ok(()));
    }

    // Dùng hook `#!/bin/sh` chậm để giữ khoá ghi: chỉ chạy trên Unix.
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
