//! Lớp Rust mỏng của Thaigit: chạy git qua bộ kiểm tra chính sách, file theo byte trong phạm vi repo, watcher có lọc,
//! hộp thoại native — giao diện và logic git nằm ở TypeScript. Đây là RANH GIỚI BẢO MẬT giữa webview (không tin cậy) và máy.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::webview::PageLoadEvent;
use tauri::{Emitter, Manager, WindowEvent};

pub mod accounts;
pub mod askpass;
pub mod avatars;
mod commands;
pub mod core;
pub mod credential;
pub mod errors;
pub mod exec;
pub mod forge;
pub mod frames;
pub mod health;
pub mod locale;
pub mod locate;
pub mod locks;
pub mod os_integration;
pub mod pathutil;
pub mod policy;
pub mod rebase;
pub mod related;
pub mod registry;
pub mod repo_fs;
pub mod safe_mode;
pub mod ssh_keys;
pub mod store;
pub mod terminal;
pub mod trust;
pub mod typed;
pub mod updater;
pub mod watcher;

// Các kịch bản dùng script `#!/bin/sh` và `touch` làm "lệnh của repo": chỉ chạy trên Unix.
#[cfg(all(test, unix))]
mod restricted_tests;
#[cfg(test)]
mod ipc_tests;
#[cfg(test)]
mod testutil;

use crate::core::{Core, EventSink};
use crate::watcher::RepoChangedEvent;

/// Đẩy sự kiện sang webview qua Tauri.
struct TauriEvents(tauri::AppHandle);

impl EventSink for TauriEvents {
    fn repo_changed(&self, window: &str, event: &RepoChangedEvent) {
        let _ = self.0.emit_to(window, "repo-changed", event);
    }

    fn git_env_changed(&self) {
        let _ = self.0.emit("git-env-changed", ());
    }
}

/// Chỉ cho điều hướng trong chính app: `tauri://` (macOS/Linux), `http(s)://tauri.localhost` (Windows), dev server khi chạy dev.
pub fn allowed_navigation(url: &url::Url, dev_url: Option<&url::Url>) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || dev_url.is_some_and(|dev| url.scheme() == dev.scheme() && url.host_str() == dev.host_str() && url.port_or_known_default() == dev.port_or_known_default())
        }
        "about" => url.as_str() == "about:blank",
        _ => false,
    }
}

/// Dựng một cửa sổ app từ cấu hình cửa sổ `main` (nhãn `label`) và gắn chốt chặn điều hướng/`window.open` ra ngoài app (CSP
/// là lớp thứ hai). Cửa sổ thêm (Ctrl/⌘+T) có nhãn `repo-N` — capability cấp quyền cho `main` và `repo-*`.
pub fn build_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>, label: &str) -> tauri::Result<()> {
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
        .ok_or_else(|| tauri::Error::WindowNotFound)?;
    config.label = label.to_string();
    let dev_url = if tauri::is_dev() { app.config().build.dev_url.clone() } else { None };
    tauri::WebviewWindowBuilder::from_config(app, &config)?
        .on_navigation(move |url| allowed_navigation(url, dev_url.as_ref()))
        .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Deny)
        .build()?;
    Ok(())
}

static WINDOW_SERIAL: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);

/// Nhãn cho cửa sổ thêm kế tiếp (`repo-N`).
pub fn next_window_label() -> String {
    let serial = WINDOW_SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("repo-{serial}")
}

/// `new_window`: mở thêm một cửa sổ (màn hình chính) để làm việc với repo khác song song.
pub fn open_new_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    build_window(app, &next_window_label())
}

/// Thư mục truyền qua dòng lệnh ("Mở bằng…"): chỉ nhận đường dẫn là thư mục thật.
fn launch_paths() -> Vec<PathBuf> {
    std::env::args_os().skip(1).filter(|a| !a.to_string_lossy().starts_with('-')).map(PathBuf::from).filter(|p| p.is_dir()).collect()
}

async fn init_git(core: Arc<Core>) {
    // Tìm git ngay với PATH sẵn có để lệnh đầu tiên chạy được; rồi nạp PATH login shell (macOS) và tìm lại.
    let _ = core.locator.refresh().await;
    core.events.git_env_changed();
    if core.locator.load_login_path(commands::LOGIN_PATH_TIMEOUT).await {
        core.events.git_env_changed();
    }
}

fn reset_window_session(app: &tauri::AppHandle, label: &str) {
    if let Some(core) = app.try_state::<Arc<Core>>() {
        core.reset_window(label);
    }
    if let Some(terminals) = app.try_state::<Arc<terminal::Terminals>>() {
        terminals.close_window(label);
    }
}

/// Context của app (cấu hình, capability, tài nguyên giao diện). `generate_context!` chỉ gọi được một lần trong crate nên
/// cả `run()` lẫn test IPC (runtime giả) đều đi qua hàm này.
fn app_context<R: tauri::Runtime>() -> tauri::Context<R> {
    tauri::generate_context!()
}

/// Đăng ký toàn bộ lệnh IPC của app (generic theo runtime để test bằng runtime giả).
fn register_commands<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
        commands::pick_repo_folder,
        commands::open_repo,
        commands::trust_repo,
        commands::list_recent_repos,
        commands::forget_recent_repo,
        commands::take_launch_paths,
        commands::git_exec,
        commands::git_cancel,
        commands::git_clone,
        commands::git_init,
        commands::git_config_set,
        commands::git_remote_add,
        commands::git_remote_set_url,
        commands::git_rebase_interactive,
        commands::git_worktree_add,
        commands::open_related_repo,
        commands::repo_health,
        commands::avatar_lookup,
        commands::remove_stale_lock,
        commands::fs_read_git_file,
        commands::fs_read_worktree_file,
        commands::fs_write_worktree_file,
        commands::fs_append_gitignore,
        commands::fs_trash_untracked,
        commands::fs_restore_trash,
        commands::fs_snapshot_index_prepare,
        commands::watch_repo,
        commands::unwatch_repo,
        commands::git_locate,
        commands::set_git_path,
        commands::pick_git_path,
        commands::open_in_terminal,
        commands::open_in_editor,
        commands::reveal,
        commands::open_url,
        commands::session_reset,
        commands::askpass_reply,
        commands::update_check,
        commands::update_install,
        commands::update_set_channel,
        commands::app_ready,
        commands::new_window,
        commands::app_set_locale,
        commands::accounts_list,
        commands::accounts_add_token,
        commands::accounts_start_login,
        commands::accounts_poll_login,
        commands::accounts_cancel_login,
        commands::accounts_remove,
        commands::accounts_set_default,
        commands::accounts_assign_owner,
        commands::accounts_set_identity,
        commands::accounts_set_client_id,
        commands::accounts_repositories,
        commands::terminal_open,
        commands::terminal_write,
        commands::terminal_resize,
        commands::terminal_close,
        commands::ssh_keys_list,
        commands::ssh_keys_generate,
        commands::ssh_keys_import,
        commands::ssh_keys_rename,
        commands::ssh_keys_remove,
        commands::ssh_keys_set_enabled,
        commands::ssh_keys_upload,
        commands::ssh_keys_test,
        commands::forge_list_merge_requests,
        commands::forge_create_merge_request,
    ])
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            // Đếm lần khởi động trước khi nạp giao diện (giao diện không lên được thì vẫn đếm).
            locale::init(app.handle(), &data_dir);
            safe_mode::init(app.handle(), &data_dir);
            let askpass_deny = std::env::current_exe().ok().and_then(|exe| askpass::prepare_deny_program(&data_dir, &exe));
            let core = Core::new(data_dir, Arc::new(TauriEvents(app.handle().clone())), askpass_deny);
            core.registry.push_launch_paths(launch_paths());
            app.manage(core.clone());
            app.manage(Arc::new(terminal::Terminals::default()));
            // Seam S0: các khung này hiện là no-op; 2b (askpass) và 8a (updater) điền thân hàm, không phải sửa lại chỗ gọi.
            askpass::init(app.handle())?;
            credential::init(app.handle())?;
            updater::init(app.handle())?;
            tauri::async_runtime::spawn(init_git(core));
            build_window(app.handle(), "main")?;
            Ok(())
        })
        // Webview tải lại: huỷ op con và bỏ watcher của phiên cũ.
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Started {
                reset_window_session(webview.app_handle(), webview.label());
            }
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Destroyed) {
                reset_window_session(window.app_handle(), window.label());
            }
        });
    let app = match register_commands(builder).build(app_context()) {
        Ok(app) => app,
        Err(error) => {
            eprintln!("không khởi động được Thaigit: {error}");
            std::process::exit(1);
        }
    };
    app.run(|handle, event| {
        // macOS: thả thư mục lên biểu tượng Dock / "Mở bằng" gửi sự kiện này thay vì argv.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event
            && let Some(core) = handle.try_state::<Arc<Core>>()
        {
            core.registry.push_launch_paths(urls.iter().filter_map(|u| u.to_file_path().ok()).filter(|p| p.is_dir()).collect());
            let _ = handle.emit("launch-paths-changed", ());
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (handle, event);
    });
}

#[cfg(test)]
mod contract_tests {
    use super::allowed_navigation;
    use std::collections::BTreeSet;

    const IPC_TS: &str = include_str!("../../../../packages/contracts/src/ipc.ts");
    const BUILD_RS: &str = include_str!("../build.rs");
    const CAPABILITY: &str = include_str!("../capabilities/default.json");
    const TAURI_CONF: &str = include_str!("../tauri.conf.json");
    const LIB_RS: &str = include_str!("lib.rs");

    /// Tên lệnh trong `export const Commands = { … }` của contracts (giá trị chuỗi).
    fn contract_commands() -> BTreeSet<String> {
        let start = IPC_TS.find("export const Commands").expect("contracts có Commands");
        let block = &IPC_TS[start..];
        let block = &block[..block.find("} as const").expect("khối Commands kết thúc")];
        regex::Regex::new(r"'([a-z_]+)'").unwrap().captures_iter(block).map(|c| c[1].to_string()).collect()
    }

    fn handler_commands() -> BTreeSet<String> {
        let start = LIB_RS.find("generate_handler![").expect("có generate_handler");
        let block = &LIB_RS[start..];
        let block = &block[..block.find(']').unwrap()];
        regex::Regex::new(r"commands::([a-z_]+)").unwrap().captures_iter(block).map(|c| c[1].to_string()).collect()
    }

    fn build_rs_commands() -> BTreeSet<String> {
        let start = BUILD_RS.find("APP_COMMANDS").unwrap();
        let block = &BUILD_RS[start..];
        let block = &block[..block.find("];").unwrap()];
        regex::Regex::new(r#""([a-z_]+)""#).unwrap().captures_iter(block).map(|c| c[1].to_string()).collect()
    }

    fn capability_commands() -> BTreeSet<String> {
        let json: serde_json::Value = serde_json::from_str(CAPABILITY).unwrap();
        json["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| p.as_str()?.strip_prefix("allow-").map(|name| name.replace('-', "_")))
            .collect()
    }

    #[test]
    fn rust_registers_exactly_the_contract_commands() {
        let contract = contract_commands();
        assert!(!contract.is_empty(), "không đọc được danh sách lệnh của contracts");
        assert_eq!(handler_commands(), contract, "generate_handler! phải khớp đúng `Commands` trong packages/contracts/src/ipc.ts");
    }

    #[test]
    fn handlers_build_manifest_and_capability_list_exactly_the_same_commands() {
        let handlers = handler_commands();
        assert_eq!(handlers, build_rs_commands(), "build.rs APP_COMMANDS lệch generate_handler!");
        assert_eq!(handlers, capability_commands(), "capabilities/default.json lệch generate_handler!");
    }

    #[test]
    fn capability_grants_no_shell_fs_dialog_or_opener_access() {
        let json: serde_json::Value = serde_json::from_str(CAPABILITY).unwrap();
        for permission in json["permissions"].as_array().unwrap() {
            let permission = permission.as_str().unwrap();
            for forbidden in ["shell", "fs:", "dialog", "opener", "http", "process", "core:default", "webview:allow-create", "window:allow-create"] {
                assert!(!permission.contains(forbidden), "capability không được cấp `{permission}`");
            }
            assert!(permission.starts_with("allow-") || permission.starts_with("core:event:") || permission == "core:window:allow-start-dragging", "{permission}");
        }
        assert_eq!(json["windows"], serde_json::json!(["main", "repo-*"]));
    }

    #[test]
    fn csp_is_strict() {
        let conf: serde_json::Value = serde_json::from_str(TAURI_CONF).unwrap();
        for key in ["csp", "devCsp"] {
            let csp = conf["app"]["security"][key].as_str().unwrap_or_else(|| panic!("thiếu {key}"));
            for required in ["default-src 'self'", "script-src 'self'", "object-src 'none'", "frame-src 'none'", "img-src 'self' blob: data:", "connect-src ipc: http://ipc.localhost"] {
                assert!(csp.contains(required), "{key} thiếu `{required}`: {csp}");
            }
            assert!(!csp.contains("unsafe-eval") && !csp.contains("script-src 'self' 'unsafe-inline'"), "{key}: {csp}");
            assert!(!csp.contains("http://*") && !csp.contains("https://*") && !csp.contains(" *"), "{key} không được mở nguồn ngoài: {csp}");
        }
        assert_eq!(conf["app"]["windows"][0]["create"], serde_json::json!(false), "cửa sổ dựng trong code để gắn chốt chặn điều hướng");
    }

    /// Windows/Android: trang là `http(s)://tauri.localhost` và IPC đi qua `http(s)://ipc.localhost` — scheme do `useHttpsScheme` của
    /// cửa sổ quyết định, nên CSP (`connect-src`) và điều hướng phải cùng theo scheme đó.
    #[test]
    fn csp_and_navigation_follow_the_window_scheme_on_windows() {
        let conf: serde_json::Value = serde_json::from_str(TAURI_CONF).unwrap();
        let uses_https = conf["app"]["windows"][0]["useHttpsScheme"].as_bool().unwrap_or(false);
        let scheme = if uses_https { "https" } else { "http" };
        for key in ["csp", "devCsp"] {
            let csp = conf["app"]["security"][key].as_str().unwrap();
            assert!(csp.contains(&format!("connect-src ipc: {scheme}://ipc.localhost")), "{key}: IPC trên Windows là {scheme}://ipc.localhost: {csp}");
        }
        let page = url::Url::parse(&format!("{scheme}://tauri.localhost/index.html")).unwrap();
        assert!(allowed_navigation(&page, None), "{page}");
        assert!(allowed_navigation(&url::Url::parse("tauri://localhost/index.html").unwrap(), None));
    }

    #[test]
    fn navigation_is_limited_to_the_app_origin() {
        let url = |s: &str| url::Url::parse(s).unwrap();
        let dev = url("http://localhost:1420");
        for ok in ["tauri://localhost/index.html", "tauri://localhost/", "http://tauri.localhost/", "https://tauri.localhost/x", "about:blank"] {
            assert!(allowed_navigation(&url(ok), None), "{ok}");
        }
        assert!(allowed_navigation(&url("http://localhost:1420/src/main.ts"), Some(&dev)));
        for bad in [
            "https://evil.example/", "http://localhost:1420/", "http://localhost:9999/", "https://tauri.localhost.evil.example/", "file:///etc/passwd",
            "javascript:alert(1)", "data:text/html,<script>", "blob:https://x/uuid", "ftp://tauri.localhost/", "tauri://evil/", "about:srcdoc", "ipc://localhost/x",
        ] {
            assert!(!allowed_navigation(&url(bad), None), "{bad}");
        }
        assert!(!allowed_navigation(&url("http://localhost:9999/"), Some(&dev)), "dev server: sai cổng");
        assert!(!allowed_navigation(&url("https://localhost:1420/"), Some(&dev)), "dev server: sai scheme");
        assert!(!allowed_navigation(&url("http://evil.example:1420/"), Some(&dev)), "dev server: sai host");
    }
}
