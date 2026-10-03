//! Chế độ an toàn khi khởi động (phase 8a). `boot.json` trong thư mục dữ liệu đếm số lần khởi động hỏng LIÊN TIẾP: mỗi lần
//! mở app tăng bộ đếm TRƯỚC khi nạp giao diện; giao diện dựng xong thì gọi `app_ready` để đặt lại về 0. Bản lỗi làm giao diện
//! không lên thì không gọi được `app_ready` — nên phần đếm / quyết định nằm ở Rust.
//!
//! Hỏng ≥ `SAFE_MODE_AFTER` lần liên tiếp → báo bằng hộp thoại native và kiểm bản cập nhật ngay (bản sửa lỗi hiện ra trên
//! thanh cập nhật khi giao diện lên được; không lên được thì lần mở sau vẫn kiểm).
//!
//! Kiểm thử khói (CI): `THAIGIT_SMOKE_EXIT=1` → app tự thoát mã 0 ngay sau khi giao diện gọi `app_ready`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use crate::errors::Result;
use crate::store;

pub const BOOT_FILE: &str = "boot.json";
/// Số lần khởi động hỏng liên tiếp để bật chế độ an toàn.
pub const SAFE_MODE_AFTER: u32 = 3;
pub const SMOKE_ENV: &str = "THAIGIT_SMOKE_EXIT";

#[derive(Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct BootRecord {
    failed_boots: u32,
}

pub struct SafeModeState {
    pub active: bool,
    path: PathBuf,
}

/// Ghi nhận một lần khởi động (coi là hỏng cho tới khi `ready`). Trả `true` nếu các lần trước đã hỏng đủ để bật chế độ an toàn.
pub fn begin_boot(data_dir: &Path) -> bool {
    let path = data_dir.join(BOOT_FILE);
    let previous = store::read_json::<BootRecord>(&path).map(|record| record.failed_boots).unwrap_or(0);
    // Không ghi được (đĩa đầy, quyền) thì thôi: chế độ an toàn chỉ là lưới đỡ, không được làm app không mở.
    let _ = store::write_json(&path, &BootRecord { failed_boots: previous.saturating_add(1) });
    previous >= SAFE_MODE_AFTER
}

/// Gọi trong `setup` (sau khi có thư mục dữ liệu, trước khi dựng cửa sổ).
pub fn init<R: Runtime>(app: &AppHandle<R>, data_dir: &Path) {
    let active = begin_boot(data_dir);
    app.manage(SafeModeState { active, path: data_dir.join(BOOT_FILE) });
    if !active {
        return;
    }
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
    app.dialog()
        .message(
            "Thaigit đã không khởi động được vài lần liên tiếp. Thaigit đang kiểm tra bản sửa lỗi — nếu có, thanh cập nhật sẽ hiện \
             ở đầu cửa sổ. Bạn vẫn dùng tiếp được.",
        )
        .title("Thaigit — chế độ an toàn")
        .kind(MessageDialogKind::Warning)
        .show(|_| {});
    if !cfg!(debug_assertions) {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            // Lỗi mạng: im lặng — vòng kiểm định kỳ của updater thử lại sau.
            let _ = crate::updater::check(&handle).await;
        });
    }
}

/// `app_ready`: giao diện đã dựng xong → đặt lại bộ đếm. Gọi nhiều lần vô hại.
pub fn ready<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    if let Some(state) = app.try_state::<SafeModeState>() {
        let _ = store::write_json(&state.path, &BootRecord::default());
    }
    if std::env::var(SMOKE_ENV).is_ok_and(|value| value == "1") {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            // Để giao diện chạy thêm chút (bắt lỗi xảy ra ngay sau khi mount) rồi mới thoát.
            tokio::time::sleep(Duration::from_secs(2)).await;
            handle.exit(0);
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_consecutive_failed_boots() {
        let dir = tempfile::tempdir().unwrap();
        // Ba lần mở mà giao diện không lên: lần thứ tư bật chế độ an toàn.
        assert!(!begin_boot(dir.path()));
        assert!(!begin_boot(dir.path()));
        assert!(!begin_boot(dir.path()));
        assert!(begin_boot(dir.path()));
        let record: BootRecord = store::read_json(&dir.path().join(BOOT_FILE)).unwrap();
        assert_eq!(record.failed_boots, 4);
    }

    #[test]
    fn ready_resets_the_counter_and_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_app();
        for _ in 0..5 {
            begin_boot(dir.path());
        }
        app.manage(SafeModeState { active: true, path: dir.path().join(BOOT_FILE) });
        assert!(ready(app.handle()).is_ok());
        assert!(ready(app.handle()).is_ok());
        assert!(!begin_boot(dir.path()), "sau app_ready, lần mở kế tiếp không còn là chế độ an toàn");
    }

    #[test]
    fn ready_without_state_is_harmless() {
        let app = tauri::test::mock_app();
        assert!(ready(app.handle()).is_ok());
    }

    #[test]
    fn corrupt_boot_file_starts_from_zero() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(BOOT_FILE), b"{hong").unwrap();
        assert!(!begin_boot(dir.path()));
    }
}
