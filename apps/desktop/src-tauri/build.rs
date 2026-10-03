/// Danh sách lệnh IPC của app. Phải khớp `generate_handler!` trong `src/lib.rs` (test `commands_registered` kiểm)
/// và `permissions` trong `capabilities/default.json` (`allow-<tên-kebab>`): có manifest thì webview chỉ gọi được
/// lệnh nào capability liệt kê — không `shell:*`, không `fs:*`.
const APP_COMMANDS: &[&str] = &[
    "pick_repo_folder",
    "open_repo",
    "trust_repo",
    "list_recent_repos",
    "forget_recent_repo",
    "take_launch_paths",
    "git_exec",
    "git_cancel",
    "git_clone",
    "git_init",
    "git_config_set",
    "git_remote_add",
    "git_remote_set_url",
    "repo_health",
    "remove_stale_lock",
    "fs_read_git_file",
    "fs_read_worktree_file",
    "fs_write_worktree_file",
    "fs_append_gitignore",
    "fs_trash_untracked",
    "fs_restore_trash",
    "watch_repo",
    "unwatch_repo",
    "git_locate",
    "set_git_path",
    "pick_git_path",
    "open_in_terminal",
    "open_in_editor",
    "reveal",
    "open_url",
    "session_reset",
    "askpass_reply",
    "update_check",
    "update_install",
    "update_set_channel",
    "app_ready",
    "new_window",
    "app_set_locale",
    "accounts_list",
    "accounts_add_token",
    "accounts_start_login",
    "accounts_poll_login",
    "accounts_cancel_login",
    "accounts_remove",
    "accounts_set_default",
    "accounts_assign_owner",
    "accounts_set_identity",
    "accounts_set_client_id",
    "accounts_repositories",
    "forge_list_merge_requests",
    "forge_create_merge_request",
];

fn main() {
    let mut attributes =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS));

    // Windows (MSVC): tauri-build chỉ nhúng manifest Common Controls v6 vào binary app, còn binary của `cargo test`
    // thì không → test dừng ngay lúc nạp (STATUS_ENTRYPOINT_NOT_FOUND: plugin dialog cần `TaskDialogIndirect` của
    // comctl32 v6). Nhúng manifest qua linker cho MỌI binary (app lẫn test) và tắt bản của tauri-build để khỏi trùng.
    // `windows-app-manifest.xml` chép nguyên văn từ tauri-build.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os == "windows" && target_env == "msvc" {
        let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"))
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        attributes = attributes.windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    }

    tauri_build::try_build(attributes).expect("tauri-build thất bại");
}
