//! Chế độ an toàn khi khởi động (phase 8a) — KHUNG của seam S0: chữ ký hàm đã chốt, thân hàm CHƯA làm.
//!
//! Ý tưởng (xem phase-08): `boot.json` trong thư mục dữ liệu đếm số lần khởi động hỏng LIÊN TIẾP; UI gọi `app_ready` khi đã dựng
//! xong để đặt lại bộ đếm. Bộ đếm ≥ 3 → không khôi phục repo, kiểm + cài bản sửa ngay (qua `updater`), báo bằng dialog native.
//! Bản lỗi làm UI không lên thì UI không gọi được `app_ready` — nên phần đếm/quyết định nằm ở Rust, trước khi nạp UI.

use tauri::{AppHandle, Runtime};

use crate::errors::Result;

/// `app_ready`: UI báo "đã sẵn sàng" → reset bộ đếm khởi động hỏng. Gọi nhiều lần vô hại (idempotent). Hiện là no-op.
pub fn ready<R: Runtime>(_app: &AppHandle<R>) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_is_idempotent() {
        let app = tauri::test::mock_app();
        assert!(ready(app.handle()).is_ok());
        assert!(ready(app.handle()).is_ok());
    }
}
