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
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),
    )
    .expect("tauri-build thất bại");
}
