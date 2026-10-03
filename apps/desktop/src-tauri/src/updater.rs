//! Cập nhật tự động (phase 8a) — KHUNG của seam S0: chữ ký hàm + kiểu dữ liệu đã chốt, thân hàm CHƯA làm.
//!
//! Việc của phase 8a ở file này: đăng ký `tauri-plugin-updater` (trong `init`), kiểm `latest.json` của kênh lúc khởi động +
//! mỗi 6 giờ rồi phát `update-available`, comparator chặn hạ cấp (`semver`), cài khi hàng đợi git rỗng và phát
//! `update-progress`. Webview chỉ gọi `update_check` / `update_install` / `update_set_channel` và nghe sự kiện; mọi quyết định
//! (kênh nào, phiên bản nào hợp lệ, khi nào cài) nằm ở Rust. Tên lệnh/sự kiện khớp `packages/contracts/src/ipc.ts`.
//!
//! Hợp đồng cho phía gọi (`commands.rs`, `lib.rs`): các hàm dưới đây là bề mặt công khai; phase 8a được đổi thân hàm và thêm
//! trường vào `UpdateInfo`, nhưng nếu phải đổi chữ ký thì sửa luôn nơi gọi (đều là lời gọi một dòng).

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::errors::{AppError, Result};

/// Kênh cập nhật: manifest `latest.json` nằm trên release cố định `desktop-<kênh>` của GitHub.
/// Chuỗi serde khớp `UpdateChannel` ở TS (`'beta' | 'stable'`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Beta,
    Stable,
}

/// Một bản cập nhật hợp lệ (đã qua chữ ký + chống hạ cấp). Khớp `UpdateInfo` ở TS (camelCase).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub version: String,
    /// Ghi chú phát hành (văn bản thường).
    pub notes: Option<String>,
    /// RFC 3339.
    pub pub_date: Option<String>,
}

fn not_implemented(what: &str) -> AppError {
    AppError::Internal(format!("Chưa làm: {what} (phase 8a)."))
}

/// Khởi tạo lúc `setup` (sau `app.manage(core)`): 8a đăng ký plugin updater, đọc kênh đã lưu, bắt đầu vòng kiểm 6 giờ/lần.
/// Hiện là no-op.
pub fn init<R: Runtime>(_app: &AppHandle<R>) -> Result<()> {
    Ok(())
}

/// `update_check`: kiểm manifest của kênh hiện tại. `Ok(None)` = đang ở bản mới nhất; `Ok(Some)` = có bản hợp lệ
/// (và phát thêm `update-available`). Hiện trả lỗi "chưa làm".
pub async fn check<R: Runtime>(_app: &AppHandle<R>) -> Result<Option<UpdateInfo>> {
    Err(not_implemented("kiểm tra cập nhật"))
}

/// `update_install`: tải + kiểm chữ ký + cài bản đã báo bởi `check`, phát `update-progress`; chỉ chạy khi hàng đợi git rỗng.
/// Hiện trả lỗi "chưa làm".
pub async fn install<R: Runtime>(_app: &AppHandle<R>) -> Result<()> {
    Err(not_implemented("cài cập nhật"))
}

/// `update_set_channel`: đổi kênh (lưu bền) rồi kiểm lại. Hiện là no-op (không lưu gì).
pub fn set_channel<R: Runtime>(_app: &AppHandle<R>, _channel: Channel) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_and_info_match_the_typescript_wire_shapes() {
        assert_eq!(serde_json::to_value(Channel::Beta).unwrap(), serde_json::json!("beta"));
        assert_eq!(serde_json::from_str::<Channel>("\"stable\"").unwrap(), Channel::Stable);
        assert!(serde_json::from_str::<Channel>("\"nightly\"").is_err(), "kênh lạ bị từ chối");
        let info = UpdateInfo { current_version: "2.0.0".into(), version: "2.0.1".into(), notes: None, pub_date: Some("2026-12-01T00:00:00Z".into()) };
        assert_eq!(
            serde_json::to_value(info).unwrap(),
            serde_json::json!({ "currentVersion": "2.0.0", "version": "2.0.1", "notes": null, "pubDate": "2026-12-01T00:00:00Z" })
        );
    }

    #[test]
    fn stubs_report_not_implemented_with_the_internal_code() {
        let app = tauri::test::mock_app();
        assert!(init(app.handle()).is_ok());
        assert!(set_channel(app.handle(), Channel::Stable).is_ok());
        let error = tauri::async_runtime::block_on(check(app.handle())).unwrap_err();
        assert_eq!(error.code(), "internal");
        assert!(tauri::async_runtime::block_on(install(app.handle())).is_err());
    }
}
