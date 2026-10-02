//! Askpass — Phase 2a chỉ có chế độ TỪ CHỐI (hồ sơ `background`, tự fetch: không bao giờ bật cửa sổ đăng nhập).
//! Askpass tương tác (`<askpass>`, token theo op, modal trong app) là Phase 2b: hồ sơ `interactive` hiện để trống.
//!
//! `main()` kiểm `--askpass-deny` TRƯỚC khi dựng Tauri và thoát mã 1, không in gì.
//!
//! Lựa chọn thiết kế: git/ssh chạy `GIT_ASKPASS`/`SSH_ASKPASS` như MỘT đường dẫn chương trình (không qua shell, không tách
//! đối số), nên `<exe> --askpass-deny` không đặt thẳng vào env được.
//!  - macOS/Linux: ghi một script `#!/bin/sh` nhỏ vào thư mục dữ liệu (`askpass-deny.sh`) rồi `exec <exe> --askpass-deny`;
//!    script được ghi lại mỗi lần khởi động nếu nội dung đổi (app chuyển chỗ/cập nhật).
//!  - Windows: `GIT_ASKPASS` trỏ thẳng vào `<exe>`; git gọi `<exe> "<prompt>"` nên argv[1] là câu hỏi, không phải cờ —
//!    vì vậy chính sách đặt thêm biến `THAIGIT_ASKPASS_DENY=1` (`policy::ASKPASS_DENY_ENV`) và `main()` coi biến đó cũng là
//!    lời gọi từ chối.

use std::ffi::OsString;
use std::path::Path;

use crate::policy::ASKPASS_DENY_ENV;

pub const DENY_FLAG: &str = "--askpass-deny";

/// Tiến trình này đang được git/ssh gọi làm askpass từ chối? (argv[1] là cờ, hoặc biến đánh dấu của hồ sơ background.)
pub fn is_deny_invocation(args: &[OsString], marker: Option<OsString>) -> bool {
    args.get(1).is_some_and(|arg| arg == DENY_FLAG) || marker.is_some_and(|value| value == "1")
}

/// Điểm vào sớm của `main()`: trả `true` nếu phải thoát ngay (mã 1, không in gì).
pub fn should_exit_early() -> bool {
    let args: Vec<OsString> = std::env::args_os().collect();
    is_deny_invocation(&args, std::env::var_os(ASKPASS_DENY_ENV))
}

/// Nội dung script bọc (Unix).
pub fn wrapper_script(exe: &Path) -> String {
    let quoted = format!("'{}'", exe.to_string_lossy().replace('\'', r"'\''"));
    format!(
        "#!/bin/sh\n# Thaigit: trả lời \"từ chối\" cho GIT_ASKPASS/SSH_ASKPASS của lệnh chạy nền (không bao giờ bật hộp thoại).\n[ -x {quoted} ] && exec {quoted} {DENY_FLAG}\nexit 1\n"
    )
}

/// Chương trình cho `<askpass-deny>`: Unix = script bọc trong thư mục dữ liệu; Windows = chính exe của app.
pub fn prepare_deny_program(data_dir: &Path, exe: &Path) -> Option<OsString> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let path = data_dir.join("askpass-deny.sh");
        let script = wrapper_script(exe);
        let current = std::fs::read_to_string(&path).ok();
        let executable = std::fs::metadata(&path).is_ok_and(|m| m.permissions().mode() & 0o111 != 0);
        if current.as_deref() != Some(script.as_str()) || !executable {
            crate::store::write_atomic(&path, script.as_bytes()).ok()?;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).ok()?;
        }
        Some(path.into_os_string())
    }
    #[cfg(not(unix))]
    {
        let _ = data_dir;
        Some(exe.as_os_str().to_os_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<OsString> {
        list.iter().map(OsString::from).collect()
    }

    #[test]
    fn recognises_both_the_flag_and_the_environment_marker() {
        assert!(is_deny_invocation(&args(&["thaigit", "--askpass-deny"]), None));
        assert!(is_deny_invocation(&args(&["thaigit", "--askpass-deny", "Username for 'https://x': "]), None));
        // Windows: git chạy `<exe> "<prompt>"`
        assert!(is_deny_invocation(&args(&["thaigit.exe", "Username for 'https://github.com': "]), Some("1".into())));
        assert!(!is_deny_invocation(&args(&["thaigit"]), None));
        assert!(!is_deny_invocation(&args(&["thaigit", "/path/to/repo"]), None));
        assert!(!is_deny_invocation(&args(&["thaigit", "--other"]), Some("0".into())));
        assert!(!is_deny_invocation(&[], None));
    }

    #[test]
    fn wrapper_script_quotes_the_executable_path() {
        let script = wrapper_script(Path::new("/Applications/Thaigit's App.app/Contents/MacOS/thaigit"));
        assert!(script.starts_with("#!/bin/sh\n"));
        assert!(script.contains(r"'/Applications/Thaigit'\''s App.app/Contents/MacOS/thaigit' --askpass-deny"));
        assert!(script.trim_end().ends_with("exit 1"));
    }

    #[cfg(unix)]
    mod unix {
        use super::*;
        use std::os::unix::fs::PermissionsExt;
        use std::process::{Command, Stdio};

        fn fake_exe(dir: &Path, marker: &Path) -> std::path::PathBuf {
            let exe = dir.join("thaigit fake");
            std::fs::write(&exe, format!("#!/bin/sh\necho \"$@\" >> '{}'\nexit 1\n", marker.display())).unwrap();
            std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
            exe
        }

        #[test]
        fn wrapper_is_written_executable_and_idempotent() {
            let dir = tempfile::tempdir().unwrap();
            let exe = fake_exe(dir.path(), &dir.path().join("marker"));
            let path = prepare_deny_program(dir.path(), &exe).unwrap();
            let path = std::path::PathBuf::from(path);
            assert_eq!(path, dir.path().join("askpass-deny.sh"));
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o755, 0o755);
            let before = std::fs::metadata(&path).unwrap().modified().unwrap();
            std::thread::sleep(std::time::Duration::from_millis(20));
            prepare_deny_program(dir.path(), &exe).unwrap();
            assert_eq!(std::fs::metadata(&path).unwrap().modified().unwrap(), before, "nội dung không đổi thì không ghi lại");
            // exe đổi chỗ → script được ghi lại
            let moved = dir.path().join("moved");
            std::fs::copy(&exe, &moved).unwrap();
            prepare_deny_program(dir.path(), &moved).unwrap();
            assert!(std::fs::read_to_string(&path).unwrap().contains("moved"));
        }

        #[test]
        fn running_the_wrapper_denies_silently_with_exit_1() {
            let dir = tempfile::tempdir().unwrap();
            let marker = dir.path().join("marker");
            let exe = fake_exe(dir.path(), &marker);
            let wrapper = std::path::PathBuf::from(prepare_deny_program(dir.path(), &exe).unwrap());
            let output = Command::new(&wrapper).arg("Password for 'https://x@github.com': ").stdin(Stdio::null()).output().unwrap();
            assert_eq!(output.status.code(), Some(1));
            assert!(output.stdout.is_empty() && output.stderr.is_empty(), "không in gì");
            assert!(std::fs::read_to_string(&marker).unwrap().contains("--askpass-deny"), "script gọi lại exe với cờ từ chối");
            // exe biến mất → vẫn từ chối (mã ≠ 0), không treo
            std::fs::remove_file(&exe).unwrap();
            let output = Command::new(&wrapper).arg("x").stdin(Stdio::null()).output().unwrap();
            assert_eq!(output.status.code(), Some(1));
        }
    }
}
