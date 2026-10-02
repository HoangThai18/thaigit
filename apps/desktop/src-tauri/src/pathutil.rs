//! Tiện ích đường dẫn dùng chung: chuẩn hoá `dunce`, so khớp tiền tố không phân biệt hoa thường (APFS/NTFS mặc định),
//! kiểm đường dẫn tương đối cho RepoFs (bản port của `packages/core/src/support/paths.ts`).

use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};

/// Ổ đĩa mặc định của macOS/Windows không phân biệt hoa thường.
pub const CASE_INSENSITIVE_FS: bool = cfg!(any(target_os = "macos", windows));

/// `realpath` + bỏ tiền tố `\\?\` trên Windows (`dunce`): luôn so khớp đường dẫn thật như watcher/FSEvents báo về.
pub fn canonical(path: &Path) -> std::io::Result<PathBuf> {
    dunce::canonicalize(path)
}

fn component_eq(a: &OsStr, b: &OsStr) -> bool {
    if a == b {
        return true;
    }
    CASE_INSENSITIVE_FS && a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
}

/// Phần còn lại của `path` bên dưới `base` (rỗng nếu bằng nhau), hoặc `None` nếu nằm ngoài. So khớp theo từng thành
/// phần nên `/a/repo2` không nằm trong `/a/repo`; không phân biệt hoa thường trên macOS/Windows.
pub fn relative_to(path: &Path, base: &Path) -> Option<PathBuf> {
    let mut path_parts = path.components();
    for base_part in base.components() {
        let part = path_parts.next()?;
        if !component_eq(part.as_os_str(), base_part.as_os_str()) {
            return None;
        }
    }
    Some(path_parts.as_path().to_path_buf())
}

/// Quy ước cho MỌI đường dẫn tương đối đi qua ranh giới IPC (UI nhận, manifest thùng rác, phân loại sự kiện watcher…): luôn dùng
/// `/` làm dấu phân tách, như git và `packages/contracts` (`checkRelativePath`). `windows` = hệ điều hành dùng `\` làm dấu
/// phân tách (trên Unix `\` là ký tự tên file hợp lệ nên giữ nguyên).
pub fn slash_relative(text: &str, windows: bool) -> String {
    if windows { text.replace('\\', "/") } else { text.to_string() }
}

/// `slash_relative` cho đường dẫn của hệ điều hành đang chạy.
pub fn path_to_slash(path: &Path) -> String {
    slash_relative(&path.to_string_lossy(), cfg!(windows))
}

/// Phần còn lại của `path` bên dưới `base` dưới dạng chuỗi tương đối dùng `/` (`None` nếu nằm ngoài).
pub fn relative_slash(path: &Path, base: &Path) -> Option<String> {
    relative_to(path, base).map(|rest| path_to_slash(&rest))
}

/// Khoá so sánh/băm cho đường dẫn (chữ thường trên ổ không phân biệt hoa thường).
pub fn path_key(path: &Path) -> String {
    let text = path.to_string_lossy();
    if CASE_INSENSITIVE_FS { text.to_lowercase() } else { text.into_owned() }
}

/// Đường dẫn tuyệt đối kiểu `/x`, `\x`, `C:\x`, `C:/x`, `\\server\share` (`C:x` không tính).
pub fn is_absolute_like(path: &str) -> bool {
    let bytes = path.as_bytes();
    path.starts_with('/')
        || path.starts_with('\\')
        || (bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && (bytes[2] == b'/' || bytes[2] == b'\\'))
}

/// Kiểm đường dẫn tương đối của RepoFs: trả lý do từ chối hoặc `None`. Luôn từ chối: rỗng, NUL, tuyệt đối, đoạn rỗng/`.`/`..`.
/// `windows` thêm: `\`, `:` (ổ đĩa, ADS), đoạn kết thúc bằng dấu chấm/khoảng trắng (Windows bỏ chúng).
pub fn check_relative_path(relative: &str, windows: bool) -> Option<&'static str> {
    if relative.is_empty() {
        return Some("đường dẫn rỗng");
    }
    if relative.contains('\0') {
        return Some("đường dẫn chứa ký tự NUL");
    }
    if is_absolute_like(relative) {
        return Some("đường dẫn tuyệt đối");
    }
    if windows && (relative.contains('\\') || relative.contains(':')) {
        return Some("đường dẫn chứa ký tự không hợp lệ trên Windows");
    }
    for segment in relative.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Some("đường dẫn chứa đoạn rỗng, \".\" hoặc \"..\"");
        }
        if windows && (segment.ends_with('.') || segment.ends_with(' ')) {
            return Some("đoạn đường dẫn kết thúc bằng dấu chấm/khoảng trắng");
        }
    }
    None
}

/// Có đoạn nào là `.git` không (không phân biệt hoa thường; bỏ dấu chấm/khoảng trắng cuối và tên ngắn NTFS `GIT~1`)?
/// RepoFs không bao giờ đọc/ghi/dời file trong `.git` qua đường working tree (ghi `.git/hooks/*` là chạy lệnh tuỳ ý).
pub fn has_git_component(relative: &str) -> bool {
    relative.split(['/', '\\']).any(|segment| {
        let folded = segment.trim_end_matches(['.', ' ']).to_lowercase();
        folded == ".git" || folded == "git~1"
    })
}

/// Như `has_git_component` nhưng cho `Path` đã chuẩn hoá (so từng thành phần thường).
pub fn path_has_git_component(path: &Path) -> bool {
    path.components().any(|c| match c {
        Component::Normal(name) => has_git_component(&name.to_string_lossy()),
        _ => false,
    })
}

/// Tên thiết bị Windows (`CON`, `NUL`, `COM1`…): mở chúng thay vì file thường.
pub fn is_windows_reserved_name(segment: &str) -> bool {
    let stem = segment.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit()
            && stem.as_bytes()[3] != b'0')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_to_matches_on_component_boundaries() {
        assert_eq!(relative_to(Path::new("/Users/a/repo/src/x.swift"), Path::new("/Users/a/repo")), Some(PathBuf::from("src/x.swift")));
        assert_eq!(relative_to(Path::new("/Users/a/repo"), Path::new("/Users/a/repo")), Some(PathBuf::new()));
        assert_eq!(relative_to(Path::new("/Users/a/repo2/x"), Path::new("/Users/a/repo")), None);
        assert_eq!(relative_to(Path::new("/Users/a"), Path::new("/Users/a/repo")), None);
        assert_eq!(relative_to(Path::new("/Users/a/Tài liệu/x"), Path::new("/Users/a/Tài liệu")), Some(PathBuf::from("x")));
    }

    #[test]
    fn relative_paths_crossing_ipc_always_use_forward_slashes() {
        // Chạy trên mọi nền tảng: dạng Windows kiểm bằng cờ `windows = true`.
        assert_eq!(slash_relative(r"refs\heads\feature\x.lock", true), "refs/heads/feature/x.lock");
        assert_eq!(slash_relative("refs/heads/main.lock", true), "refs/heads/main.lock", "đã là `/` thì giữ nguyên");
        assert_eq!(slash_relative(r"Tài liệu\ghi chú.md", true), "Tài liệu/ghi chú.md");
        assert_eq!(slash_relative("", true), "");
        // Unix: `\` là một ký tự của tên file, không phải dấu phân tách.
        assert_eq!(slash_relative(r"dir/a\b.txt", false), r"dir/a\b.txt");
        // Với đường dẫn thật của nền tảng hiện tại (Windows: `\` do `join` sinh ra) kết quả vẫn là `/`.
        let base = std::env::temp_dir().join("thaigit-pathutil");
        let nested = base.join("refs").join("heads").join("main.lock");
        assert_eq!(relative_slash(&nested, &base).as_deref(), Some("refs/heads/main.lock"));
        assert_eq!(relative_slash(&base, &base).as_deref(), Some(""));
        assert_eq!(relative_slash(&std::env::temp_dir().join("thaigit-other").join("x"), &base), None);
        assert_eq!(path_to_slash(&PathBuf::from("a").join("b").join("c.txt")), "a/b/c.txt");
    }

    #[test]
    fn relative_to_ignores_case_on_default_volumes() {
        let result = relative_to(Path::new("/Users/a/Repo/src/x.swift"), Path::new("/Users/a/repo"));
        if CASE_INSENSITIVE_FS {
            assert_eq!(result, Some(PathBuf::from("src/x.swift")));
            assert_eq!(relative_to(Path::new("/Users/a/Tài Liệu/x"), Path::new("/users/a/tài liệu")), Some(PathBuf::from("x")));
        } else {
            assert_eq!(result, None);
        }
    }

    #[test]
    fn relative_path_checks_mirror_the_typescript_helper() {
        for bad in ["", "a\0b", "/etc/passwd", "\\x", "C:\\x", "C:/x", "\\\\server\\share", "../x", "a/../b", "a//b", "./a", "a/", "a/."] {
            assert!(check_relative_path(bad, false).is_some(), "{bad:?} phải bị từ chối");
        }
        for good in ["a.txt", "dir/sub/file.rs", "tài liệu/ghi chú.md", "a b/c", "C:x", ".gitignore", "a\\b", "a:b"] {
            assert!(check_relative_path(good, false).is_none(), "{good:?} phải hợp lệ trên Unix");
        }
        // Windows: `\`, `:`, đoạn kết thúc bằng chấm/khoảng trắng.
        for bad in ["a\\b", "a:b", "C:x", "file.", "dir /x", "dir./x", "a/b "] {
            assert!(check_relative_path(bad, true).is_some(), "{bad:?} phải bị từ chối trên Windows");
        }
        assert!(check_relative_path("dir/file.txt", true).is_none());
    }

    #[test]
    fn git_components_are_detected_like_the_node_adapter() {
        for hit in [
            ".git", ".git/hooks/pre-commit", "a/.git/config", "A/.GIT/x", ".Git", ".git.", ".git ", ".git. .", "x/.git./y", "GIT~1/hooks",
            "git~1", "sub\\.git\\config", "sub\\GIT~1",
        ] {
            assert!(has_git_component(hit), "{hit:?}");
        }
        for miss in [".gitignore", ".github/workflows/x.yml", "git", "a/gitx", "digit/x", ".gitattributes", "x.git", "git~2", "my.git/x"] {
            assert!(!has_git_component(miss), "{miss:?}");
        }
        assert!(path_has_git_component(Path::new("a/.git/hooks")));
        assert!(!path_has_git_component(Path::new("a/.github")));
    }

    #[test]
    fn windows_device_names() {
        for name in ["CON", "con.txt", "NUL", "aux.c", "COM1", "lpt9.log", "PRN"] {
            assert!(is_windows_reserved_name(name), "{name}");
        }
        for name in ["console", "COM0", "COM10", "com", "a.con", "nul2"] {
            assert!(!is_windows_reserved_name(name), "{name}");
        }
    }
}
