// Windows release builds do not open a console window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // git/ssh call this very binary as the deny askpass (background profile): exit 1, print nothing, BEFORE building Tauri.
    if thaigit_lib::askpass::should_exit_early() {
        std::process::exit(1);
    }
    // git/ssh call this binary as the interactive askpass (interactive profile): ask the app over 127.0.0.1, print the answer.
    if let Some(code) = thaigit_lib::askpass::client_exit_code() {
        std::process::exit(code);
    }
    // git calls this very binary as the credential helper (`get`): return the account's token for that host, then exit.
    if let Some(code) = thaigit_lib::credential::client_exit_code() {
        std::process::exit(code);
    }
    thaigit_lib::run()
}
