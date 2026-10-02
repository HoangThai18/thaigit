//! Test IPC THẬT qua runtime giả của Tauri (không mở cửa sổ): đối số đúng như phía TypeScript gửi (camelCase, `Channel`,
//! thân byte thô + header), dạng lỗi `{ code, message }`, ACL của `capabilities/default.json` (chỉ cửa sổ `main`, chỉ lệnh
//! của app) — dùng `generate_context!()` thật nên capability được kiểm đúng như bản chạy.

use std::sync::Arc;

use serde_json::{Value, json};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::core::Core;
use crate::testutil::{TestRepo, core_with, open};

struct Harness {
    _app: App<MockRuntime>,
    main: WebviewWindow<MockRuntime>,
    other: WebviewWindow<MockRuntime>,
    core: Arc<Core>,
    repo: TestRepo,
    repo_id: String,
    _data: tempfile::TempDir,
}

fn harness() -> Harness {
    tauri::async_runtime::block_on(async {
        let repo = TestRepo::new();
        repo.write("a.txt", "một\n");
        repo.commit_all("init");
        let (core, data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        let app = crate::register_commands(mock_builder())
            .manage(core.clone())
            .build(crate::app_context())
            .expect("dựng được app giả với capability thật");
        let main = WebviewWindowBuilder::new(&app, "main", WebviewUrl::App("index.html".into())).build().unwrap();
        let other = WebviewWindowBuilder::new(&app, "other", WebviewUrl::App("index.html".into())).build().unwrap();
        Harness { _app: app, main, other, core, repo, repo_id: opened.repo_id, _data: data }
    })
}

/// URL trang của webview do CHÍNH Tauri tính (`webview.url()`), không hard-code: origin "local" của ACL khác nhau theo nền tảng —
/// `tauri://localhost` trên macOS/Linux, `http(s)://tauri.localhost` trên Windows/Android — và `devUrl` khi build dev.
fn page_url(window: &WebviewWindow<MockRuntime>) -> String {
    window.url().expect("cửa sổ giả có URL").to_string()
}

fn request_at(url: &str, cmd: &str, body: InvokeBody, headers: tauri::http::HeaderMap) -> InvokeRequest {
    InvokeRequest {
        cmd: cmd.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: url.parse().unwrap(),
        body,
        headers,
        invoke_key: INVOKE_KEY.to_string(),
    }
}

/// Yêu cầu IPC đến từ chính trang của cửa sổ (origin local).
fn request(window: &WebviewWindow<MockRuntime>, cmd: &str, body: InvokeBody, headers: tauri::http::HeaderMap) -> InvokeRequest {
    request_at(&page_url(window), cmd, body, headers)
}

fn json_call(window: &WebviewWindow<MockRuntime>, cmd: &str, args: Value) -> Result<Value, Value> {
    get_ipc_response(window, request(window, cmd, InvokeBody::Json(args), Default::default())).map(|body| match body {
        InvokeResponseBody::Json(text) => serde_json::from_str(&text).unwrap(),
        InvokeResponseBody::Raw(bytes) => panic!("mong JSON, nhận {} byte thô", bytes.len()),
    })
}

fn raw_call(window: &WebviewWindow<MockRuntime>, cmd: &str, bytes: Vec<u8>, headers: &[(&str, &str)]) -> Result<InvokeResponseBody, Value> {
    let mut map = tauri::http::HeaderMap::new();
    for (name, value) in headers {
        map.insert(tauri::http::HeaderName::from_bytes(name.as_bytes()).unwrap(), tauri::http::HeaderValue::from_str(value).unwrap());
    }
    get_ipc_response(window, request(window, cmd, InvokeBody::Raw(bytes), map))
}

fn code(error: &Value) -> String {
    error.get("code").and_then(Value::as_str).unwrap_or("?").to_string()
}

#[test]
fn simple_commands_round_trip_with_camel_case_shapes() {
    let h = harness();
    assert_eq!(json_call(&h.main, "list_recent_repos", json!({})).unwrap().as_array().map(Vec::len), Some(1), "repo vừa mở có trong danh sách gần đây");
    let recent = json_call(&h.main, "list_recent_repos", json!({})).unwrap();
    assert_eq!(recent[0]["id"], json!(h.repo_id));
    assert!(recent[0]["lastOpened"].is_u64(), "{recent}");
    assert_eq!(json_call(&h.main, "take_launch_paths", json!({})).unwrap(), json!([]));
    assert_eq!(json_call(&h.main, "git_cancel", json!({ "opId": "khong-co" })).unwrap(), json!(false));
    assert_eq!(json_call(&h.main, "session_reset", json!({})).unwrap(), Value::Null);
    let health = json_call(&h.main, "repo_health", json!({ "repoId": h.repo_id })).unwrap();
    assert_eq!(health, json!({ "staleLocks": [], "operation": null, "busy": false }));
    let git = json_call(&h.main, "git_locate", json!({})).unwrap();
    for key in ["path", "version", "versionTuple", "source", "tooOld", "belowSecurityFloor", "minimumVersion", "warning", "loginShellPathLoaded", "candidates"] {
        assert!(git.get(key).is_some(), "GitInfo thiếu `{key}`: {git}");
    }
    let trusted = json_call(&h.main, "trust_repo", json!({ "repoId": h.repo_id })).unwrap();
    for key in ["repoId", "root", "gitDir", "commonDir", "trust", "findings"] {
        assert!(trusted.get(key).is_some(), "OpenedRepo thiếu `{key}`: {trusted}");
    }
    assert_eq!(trusted["trust"], json!("trusted"));
    assert_eq!(json_call(&h.main, "forget_recent_repo", json!({ "id": h.repo_id })).unwrap(), Value::Null);
}

#[test]
fn errors_cross_the_ipc_boundary_as_code_and_message() {
    let h = harness();
    let error = json_call(&h.main, "open_repo", json!({ "source": { "kind": "picked", "token": "bịa" } })).unwrap_err();
    assert_eq!(code(&error), "not-found");
    assert!(error["message"].as_str().is_some_and(|m| !m.is_empty()));
    let error = json_call(&h.main, "open_repo", json!({ "source": { "kind": "recent", "id": "khong-co" } })).unwrap_err();
    assert_eq!(code(&error), "not-found");
    let error = json_call(&h.main, "repo_health", json!({ "repoId": "khong-co" })).unwrap_err();
    assert_eq!(code(&error), "not-found");
    // đối số sai kiểu → lỗi của Tauri (chuỗi), không panic
    assert!(json_call(&h.main, "repo_health", json!({ "wrong": 1 })).is_err());
}

#[test]
fn git_exec_runs_policy_checked_commands_and_rejects_attacks() {
    let h = harness();
    let call = |op: &str, kind: &str, sub: &str, args: Value, env: Value| {
        json_call(
            &h.main,
            "git_exec",
            json!({
                "req": { "repoId": h.repo_id, "opId": op, "kind": kind, "sub": sub, "args": args, "env": env },
                "channel": "__CHANNEL__:7",
            }),
        )
    };
    // Lệnh hợp lệ chạy thật (commit rỗng tạo commit mới) và command trả `()`.
    assert_eq!(call("c1", "write", "commit", json!(["--allow-empty", "-m", "qua IPC"]), Value::Null).unwrap(), Value::Null);
    assert_eq!(h.repo.git(&["rev-list", "--count", "HEAD"]).trim(), "2");
    assert_eq!(h.repo.git(&["log", "-1", "--format=%s"]).trim(), "qua IPC");
    assert_eq!(call("s1", "read", "status", json!(["--porcelain=v2"]), json!({ "GIT_OPTIONAL_LOCKS": "0" })).unwrap(), Value::Null);
    // Tấn công bị chặn trước khi chạy, với mã `policy`.
    let marker = h.repo.tmp().join("pwned");
    let touch = format!("touch {}", marker.display());
    for (kind, sub, args, env) in [
        ("read", "status", json!(["-c", format!("core.fsmonitor={touch}")]), Value::Null),
        ("network", "fetch", json!([format!("--upload-pack={touch}"), "origin"]), Value::Null),
        ("network", "pull", json!([format!("ext::sh -c {touch}"), "main"]), Value::Null),
        ("read", "status", json!([]), json!({ "GIT_SSH_COMMAND": touch })),
        ("read", "difftool", json!([]), Value::Null),
        ("read", "status", json!([]), json!({ "GIT_CONFIG_COUNT": "1" })),
    ] {
        let error = call("evil", kind, sub, args, env).unwrap_err();
        assert_eq!(code(&error), "policy", "{sub}: {error}");
    }
    assert!(!marker.exists());
    // opId trùng chữ hoa/ký tự lạ
    assert_eq!(code(&call("../x", "read", "status", json!([]), Value::Null).unwrap_err()), "policy");
    // JS không gửi được cwd/đường dẫn tuỳ ý: trường lạ bị bỏ qua, repo không có thì not-found
    let error = json_call(&h.main, "git_exec", json!({ "req": { "repoId": "/etc", "opId": "x1", "kind": "read", "sub": "status", "args": [] }, "channel": "__CHANNEL__:8" })).unwrap_err();
    assert_eq!(code(&error), "not-found");
}

#[test]
fn raw_file_io_carries_bytes_and_percent_encoded_headers() {
    let h = harness();
    let id = h.repo_id.as_str();
    let rel = "tài liệu/ghi chú.txt";
    let encoded = "t%C3%A0i%20li%E1%BB%87u/ghi%20ch%C3%BA.txt";
    // thư mục cha chưa có → not-found; tạo rồi ghi
    std::fs::create_dir_all(h.repo.root().join("tài liệu")).unwrap();
    let payload = b"\xEF\xBB\xBFxin ch\xC3\xA0o\r\n\xE9\x00\xFF".to_vec();
    let write = |expected: &str, bytes: Vec<u8>| raw_call(&h.main, "fs_write_worktree_file", bytes, &[("x-repo-id", id), ("x-rel", encoded), ("x-expected-sha256", expected)]);
    match write("", payload.clone()).unwrap() {
        InvokeResponseBody::Json(text) => assert_eq!(text, "null"),
        InvokeResponseBody::Raw(_) => panic!("mong JSON null"),
    }
    assert_eq!(h.repo.read(rel), payload, "byte giữ nguyên qua IPC (BOM, CRLF, Latin-1, NUL)");
    // đọc lại: thân trả về là byte thô
    let read = get_ipc_response(&h.main, request(&h.main, "fs_read_worktree_file", InvokeBody::Json(json!({ "repoId": id, "rel": rel, "maxBytes": null })), Default::default())).unwrap();
    assert!(matches!(&read, InvokeResponseBody::Raw(bytes) if *bytes == payload), "{read:?}");
    // CAS: ghi đè với băm sai → conflict; băm đúng → ok
    let wrong = write(&"0".repeat(64), b"x".to_vec()).unwrap_err();
    assert_eq!(code(&wrong), "conflict");
    let correct = {
        use sha2::{Digest, Sha256};
        crate::trust::hex(&Sha256::digest(&payload))
    };
    write(&correct, b"v2".to_vec()).unwrap();
    assert_eq!(h.repo.read(rel), b"v2");
    // thiếu header / thân không phải byte thô
    assert_eq!(code(&raw_call(&h.main, "fs_write_worktree_file", vec![1], &[("x-repo-id", id)]).unwrap_err()), "policy");
    assert_eq!(code(&json_call(&h.main, "fs_write_worktree_file", json!({ "x": 1 })).unwrap_err()), "policy");
    // phạm vi: `..`, tuyệt đối, `.git`
    for bad in ["..%2Fescape.txt", "%2Fetc%2Fpasswd", ".git%2Fhooks%2Fpre-commit", ".GIT%2Fconfig", "GIT~1%2Fhooks%2Fx"] {
        let error = raw_call(&h.main, "fs_write_worktree_file", b"x".to_vec(), &[("x-repo-id", id), ("x-rel", bad), ("x-expected-sha256", "")]).unwrap_err();
        assert_eq!(code(&error), "out-of-scope", "{bad}");
    }
    assert!(!h.repo.root().join(".git/hooks/pre-commit").exists());
    // đọc file không tồn tại → not-found (TS đổi thành null)
    let missing = json_call(&h.main, "fs_read_worktree_file", json!({ "repoId": id, "rel": "khong-co.txt" })).unwrap_err();
    assert_eq!(code(&missing), "not-found");
    // gitignore / thùng rác
    assert_eq!(json_call(&h.main, "fs_append_gitignore", json!({ "repoId": id, "line": "dist/" })).unwrap(), Value::Null);
    assert_eq!(h.repo.read(".gitignore"), b"dist/\n");
    h.repo.write("rac.txt", "x");
    let token = json_call(&h.main, "fs_trash_untracked", json!({ "repoId": id, "rels": ["rac.txt"] })).unwrap();
    assert!(token.as_str().is_some_and(|t| t.contains('-')));
    assert!(!h.repo.exists("rac.txt"));
    assert_eq!(json_call(&h.main, "fs_restore_trash", json!({ "repoId": id, "token": token })).unwrap(), Value::Null);
    assert!(h.repo.exists("rac.txt"));
    // file git: danh sách cho phép
    assert_eq!(code(&json_call(&h.main, "fs_read_git_file", json!({ "repoId": id, "rel": "config" })).unwrap_err()), "out-of-scope");
    assert_eq!(code(&json_call(&h.main, "fs_read_git_file", json!({ "repoId": id, "rel": "MERGE_HEAD" })).unwrap_err()), "not-found");
}

#[test]
fn typed_git_commands_validate_inputs_over_ipc() {
    let h = harness();
    let id = h.repo_id.as_str();
    assert_eq!(json_call(&h.main, "git_config_set", json!({ "repoId": id, "key": "user.name", "value": "Phan Thái", "scope": "local" })).unwrap(), Value::Null);
    assert_eq!(h.repo.git(&["config", "--local", "--get", "user.name"]).trim(), "Phan Thái");
    let denied = json_call(&h.main, "git_config_set", json!({ "repoId": id, "key": "core.fsmonitor", "value": "touch x", "scope": "local" })).unwrap_err();
    assert_eq!(code(&denied), "policy");
    assert!(json_call(&h.main, "git_config_set", json!({ "repoId": id, "key": "user.name", "value": "x", "scope": "system" })).is_err(), "scope lạ bị từ chối");
    assert_eq!(json_call(&h.main, "git_remote_add", json!({ "repoId": id, "name": "origin", "url": "https://github.com/a/b.git" })).unwrap(), Value::Null);
    assert_eq!(code(&json_call(&h.main, "git_remote_add", json!({ "repoId": id, "name": "evil", "url": "ext::sh -c id" })).unwrap_err()), "policy");
    assert_eq!(code(&json_call(&h.main, "git_remote_set_url", json!({ "repoId": id, "name": "origin", "url": "-oProxyCommand=x" })).unwrap_err()), "policy");
    assert_eq!(h.repo.git(&["remote", "get-url", "origin"]).trim(), "https://github.com/a/b.git");
}

#[test]
fn open_url_over_ipc_only_accepts_https() {
    let h = harness();
    for bad in ["file:///etc/passwd", "javascript:alert(1)", "http://example.com", "search-ms:query=x", "https://user:pw@example.com"] {
        let error = json_call(&h.main, "open_url", json!({ "url": bad, "confirmed": true })).unwrap_err();
        assert_eq!(code(&error), "policy", "{bad}");
    }
    assert_eq!(code(&json_call(&h.main, "open_url", json!({ "url": "mailto:a@b.c" })).unwrap_err()), "policy", "mailto cần xác nhận");
    assert_eq!(code(&json_call(&h.main, "open_in_editor", json!({ "repoId": h.repo_id, "path": "../x" })).unwrap_err()), "out-of-scope");
}

#[test]
fn capability_only_allows_the_main_window_and_app_commands() {
    let h = harness();
    // cùng lệnh, cửa sổ khác `main` → ACL từ chối
    let error = json_call(&h.other, "list_recent_repos", json!({})).unwrap_err();
    let text = error.as_str().map(str::to_string).unwrap_or_else(|| error.to_string());
    assert!(text.to_lowercase().contains("not allowed") || text.to_lowercase().contains("permission"), "{text}");
    assert!(json_call(&h.other, "git_exec", json!({ "req": { "repoId": h.repo_id, "opId": "x", "kind": "read", "sub": "status", "args": [] }, "channel": "__CHANNEL__:1" })).is_err());
    assert!(h.core.ops.is_empty());
    // Không có đường nào tới shell / fs / dialog / opener / process từ webview.
    for command in [
        "plugin:shell|execute", "plugin:shell|spawn", "plugin:shell|open", "plugin:fs|read_file", "plugin:fs|write_file", "plugin:fs|read_dir", "plugin:fs|remove",
        "plugin:dialog|open", "plugin:dialog|save", "plugin:opener|open_path", "plugin:opener|open_url", "plugin:process|exit", "plugin:updater|check", "plugin:http|fetch",
        "plugin:webview|create_webview_window", "plugin:window|create", "plugin:app|app_hide", "plugin:path|resolve_directory", "plugin:resources|close",
    ] {
        assert!(json_call(&h.main, command, json!({})).is_err(), "{command} không được phép");
    }
    // lệnh không tồn tại
    assert!(json_call(&h.main, "run_shell", json!({ "cmd": "id" })).is_err());
    // sự kiện: cửa sổ main được listen, nhưng không được emit tuỳ ý tới backend (core:event:allow-emit không được cấp)
    assert!(json_call(&h.main, "plugin:event|emit", json!({ "event": "x", "payload": 1 })).is_err());
    assert!(json_call(&h.main, "plugin:event|listen", json!({ "event": "repo-changed", "target": { "kind": "Any" }, "handler": 1 })).is_ok());
}

/// Origin "local" của app trong bản chạy thật (đúng như Tauri tính: `cfg!(windows | android)` → `http://tauri.localhost`).
fn production_origin() -> &'static str {
    if cfg!(any(windows, target_os = "android")) { "http://tauri.localhost/" } else { "tauri://localhost/" }
}

#[test]
fn the_production_origin_is_allowed_by_both_the_acl_and_navigation_and_foreign_origins_are_not() {
    let h = harness();
    let origin = production_origin();
    // Điều hướng của app (lib.rs) và ACL phải cùng coi origin này là local — trên Windows là `http://tauri.localhost`.
    assert!(crate::allowed_navigation(&origin.parse().unwrap(), None), "{origin}");
    let ok = get_ipc_response(&h.main, request_at(origin, "list_recent_repos", InvokeBody::Json(json!({})), Default::default()));
    assert!(ok.is_ok(), "{origin}: {ok:?}");
    // Trang từ origin ngoài không được gọi lệnh nào của app, dù cùng cửa sổ `main`.
    for remote in ["https://evil.example/", "http://tauri.localhost.evil.example/", "https://tauri.localhost.evil.example/", "http://localhost:9999/"] {
        let denied = get_ipc_response(&h.main, request_at(remote, "list_recent_repos", InvokeBody::Json(json!({})), Default::default()));
        let message = denied.expect_err(remote).to_string().to_lowercase();
        assert!(message.contains("not allowed"), "{remote}: {message}");
        assert!(!crate::allowed_navigation(&remote.parse().unwrap(), None), "{remote}");
    }
}

#[test]
fn app_state_is_shared_between_ipc_and_the_core() {
    let h = harness();
    let state = h.main.app_handle().state::<Arc<Core>>();
    assert!(Arc::ptr_eq(&state.inner().clone(), &h.core));
}
