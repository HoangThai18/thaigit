// Bản release trên Windows không bật cửa sổ console thừa.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // git/ssh gọi chính binary này làm askpass từ chối (hồ sơ background): thoát mã 1, không in gì, TRƯỚC khi dựng Tauri.
    if thaigit_lib::askpass::should_exit_early() {
        std::process::exit(1);
    }
    // git/ssh gọi binary này làm askpass tương tác (hồ sơ interactive): hỏi app qua 127.0.0.1 rồi in câu trả lời.
    if let Some(code) = thaigit_lib::askpass::client_exit_code() {
        std::process::exit(code);
    }
    // git gọi chính binary này làm credential helper (`get`): trả token của tài khoản cho host đó rồi thoát.
    if let Some(code) = thaigit_lib::credential::client_exit_code() {
        std::process::exit(code);
    }
    thaigit_lib::run()
}
