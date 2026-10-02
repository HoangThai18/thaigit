// Bản release trên Windows không bật cửa sổ console thừa.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // git/ssh gọi chính binary này làm askpass từ chối (hồ sơ background): thoát mã 1, không in gì, TRƯỚC khi dựng Tauri.
    if thaigit_lib::askpass::should_exit_early() {
        std::process::exit(1);
    }
    thaigit_lib::run()
}
