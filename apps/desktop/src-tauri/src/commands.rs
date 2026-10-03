//! Lệnh IPC: lớp mỏng giữa webview và `Core`. Tên lệnh khớp đúng `Commands` trong `packages/contracts/src/ipc.ts`.
//! Webview là bên không tin cậy: mọi tham số đều được `Core` kiểm; đường dẫn chỉ đến từ token do Rust cấp.

use std::sync::Arc;
use std::time::Duration;

use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request, Response};
use tauri::{AppHandle, Runtime, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::accounts::{AccountsView, Provider};
use crate::core::{Core, GitExecRequest};
use crate::errors::{AppError, Result};
use crate::forge::{self, DeviceCode, ForgeMergeRequest, ForgeRepository};
use crate::exec::FrameSink;
use crate::health::RepoHealth;
use crate::locate::GitInfo;
use crate::os_integration;
use crate::registry::{OpenSource, OpenedRepo, PickedFolder, RecentRepo, new_detach_flag};
use crate::repo_fs;
use crate::typed::ConfigScope;
use crate::updater::UpdateInfo;
use crate::{askpass, safe_mode, updater};

type CoreState<'a> = State<'a, Arc<Core>>;

/// Đưa frame vào `Channel<InvokeResponseBody>` dưới dạng Raw (không qua JSON).
struct ChannelSink(Channel<InvokeResponseBody>);

impl FrameSink for ChannelSink {
    fn send(&self, frame: Vec<u8>) {
        // Webview đã tải lại/đóng: bỏ frame, tiến trình git vẫn được chờ và dọn như bình thường.
        let _ = self.0.send(InvokeResponseBody::Raw(frame));
    }
}

fn join_error(error: tokio::task::JoinError) -> AppError {
    AppError::Internal(format!("Tác vụ nền lỗi: {error}"))
}

// --- repo ---------------------------------------------------------------------------------------------------------------

/// Hộp thoại native chọn thư mục; trả token (không phải đường dẫn tuỳ ý) để `open_repo`/`git_clone`/`git_init` dùng.
#[tauri::command]
pub async fn pick_repo_folder<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>, core: CoreState<'_>) -> Result<Option<PickedFolder>> {
    let dialog = app.dialog().file().set_parent(&window).set_title(crate::locale::current(&app).texts().pick_folder);
    let picked = tokio::task::spawn_blocking(move || dialog.blocking_pick_folder()).await.map_err(join_error)?;
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| AppError::Io(format!("Đường dẫn đã chọn không hợp lệ: {e}")))?;
    let path = crate::pathutil::canonical(&path).map_err(|e| AppError::io("Thư mục đã chọn", &e))?;
    Ok(Some(core.registry.grant_folder(&path)))
}

#[tauri::command]
pub async fn open_repo(core: CoreState<'_>, source: OpenSource) -> Result<OpenedRepo> {
    core.open_repo(source).await
}

#[tauri::command]
pub async fn trust_repo(core: CoreState<'_>, repo_id: String) -> Result<OpenedRepo> {
    core.trust_repo(&repo_id).await
}

#[tauri::command]
pub fn list_recent_repos(core: CoreState<'_>) -> Vec<RecentRepo> {
    core.registry.recent_list()
}

#[tauri::command]
pub fn forget_recent_repo(core: CoreState<'_>, id: String) {
    core.registry.forget_recent(&id);
}

/// Thư mục do hệ điều hành đưa vào lúc khởi động ("Mở bằng", argv): lấy một lần, dạng token.
#[tauri::command]
pub fn take_launch_paths(core: CoreState<'_>) -> Vec<PickedFolder> {
    core.registry.take_launch_paths()
}

// --- git ----------------------------------------------------------------------------------------------------------------

/// Chạy git (đã qua chính sách) và stream frame Raw `[tag|bytes]` qua `channel`; lệnh trả `()` — phía TS chỉ resolve khi nhận frame exit.
#[tauri::command]
pub async fn git_exec<R: Runtime>(window: WebviewWindow<R>, core: CoreState<'_>, req: GitExecRequest, channel: Channel<InvokeResponseBody>) -> Result<()> {
    core.inner().clone().exec_git(window.label(), req, Arc::new(ChannelSink(channel)), new_detach_flag()).await
}

#[tauri::command]
pub fn git_cancel<R: Runtime>(window: WebviewWindow<R>, core: CoreState<'_>, op_id: String) -> Result<bool> {
    core.cancel_op(window.label(), &op_id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn git_clone<R: Runtime>(
    window: WebviewWindow<R>,
    core: CoreState<'_>,
    url: String,
    dest_token: String,
    name: Option<String>,
    op_id: String,
    channel: Channel<InvokeResponseBody>,
) -> Result<OpenedRepo> {
    core.inner()
        .clone()
        .git_clone(window.label(), &url, &dest_token, name.as_deref(), &op_id, Arc::new(ChannelSink(channel)), new_detach_flag())
        .await
}

#[tauri::command]
pub async fn git_init(core: CoreState<'_>, dest_token: String, name: Option<String>) -> Result<OpenedRepo> {
    core.git_init(&dest_token, name.as_deref()).await
}

#[tauri::command]
pub async fn git_config_set(core: CoreState<'_>, repo_id: String, key: String, value: String, scope: ConfigScope) -> Result<()> {
    core.git_config_set(&repo_id, &key, &value, scope).await
}

#[tauri::command]
pub async fn git_remote_add(core: CoreState<'_>, repo_id: String, name: String, url: String) -> Result<()> {
    core.git_remote_add(&repo_id, &name, &url).await
}

#[tauri::command]
pub async fn git_remote_set_url(core: CoreState<'_>, repo_id: String, name: String, url: String) -> Result<()> {
    core.git_remote_set_url(&repo_id, &name, &url).await
}

#[tauri::command]
pub fn repo_health(core: CoreState<'_>, repo_id: String) -> Result<RepoHealth> {
    core.repo_health(&repo_id)
}

#[tauri::command]
pub fn remove_stale_lock(core: CoreState<'_>, repo_id: String, path: String) -> Result<()> {
    core.remove_stale_lock(&repo_id, &path)
}

// --- RepoFs -------------------------------------------------------------------------------------------------------------

#[tauri::command]
pub async fn fs_read_git_file(core: CoreState<'_>, repo_id: String, rel: String) -> Result<Response> {
    let entry = core.registry.get(&repo_id)?;
    let name = rel.clone();
    let bytes = tokio::task::spawn_blocking(move || repo_fs::read_git_file(&entry, &rel)).await.map_err(join_error)??;
    bytes.map(Response::new).ok_or_else(|| AppError::NotFound(format!("`{name}` không tồn tại")))
}

#[tauri::command]
pub async fn fs_read_worktree_file(core: CoreState<'_>, repo_id: String, rel: String, max_bytes: Option<u64>) -> Result<Response> {
    let entry = core.registry.get(&repo_id)?;
    let name = rel.clone();
    let bytes = tokio::task::spawn_blocking(move || repo_fs::read_worktree_file(&entry, &rel, max_bytes)).await.map_err(join_error)??;
    bytes.map(Response::new).ok_or_else(|| AppError::NotFound(format!("`{name}` không tồn tại")))
}

fn header(request: &Request<'_>, name: &str) -> Result<String> {
    let value = request
        .headers()
        .get(name)
        .ok_or_else(|| AppError::policy(format!("thiếu header `{name}`")))?
        .to_str()
        .map_err(|_| AppError::policy(format!("header `{name}` không hợp lệ")))?;
    percent_encoding::percent_decode_str(value)
        .decode_utf8()
        .map(|decoded| decoded.into_owned())
        .map_err(|_| AppError::policy(format!("header `{name}` không phải UTF-8")))
}

/// Ghi file theo byte: thân yêu cầu là byte thô (không JSON); tham số nằm ở header `x-repo-id`, `x-rel` (percent-encoded),
/// `x-expected-sha256` (hex; rỗng = file phải chưa tồn tại).
#[tauri::command]
pub async fn fs_write_worktree_file(core: CoreState<'_>, request: Request<'_>) -> Result<()> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::policy("fs_write_worktree_file cần thân yêu cầu dạng byte thô"));
    };
    let bytes = bytes.clone();
    let repo_id = header(&request, "x-repo-id")?;
    let rel = header(&request, "x-rel")?;
    let expected = header(&request, "x-expected-sha256")?;
    let entry = core.registry.get(&repo_id)?;
    tokio::task::spawn_blocking(move || {
        let expected = (!expected.is_empty()).then_some(expected);
        repo_fs::write_worktree_file(&entry, &rel, &bytes, expected.as_deref())
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
pub async fn fs_append_gitignore(core: CoreState<'_>, repo_id: String, line: String) -> Result<()> {
    let entry = core.registry.get(&repo_id)?;
    tokio::task::spawn_blocking(move || repo_fs::append_gitignore(&entry, &line)).await.map_err(join_error)?
}

#[tauri::command]
pub async fn fs_trash_untracked(core: CoreState<'_>, repo_id: String, rels: Vec<String>) -> Result<String> {
    core.trash_untracked(&repo_id, rels).await
}

#[tauri::command]
pub async fn fs_restore_trash(core: CoreState<'_>, repo_id: String, token: String) -> Result<()> {
    core.restore_trash(&repo_id, token).await
}

#[tauri::command]
pub async fn fs_snapshot_index_prepare(core: CoreState<'_>, repo_id: String, reset: bool) -> Result<String> {
    core.snapshot_index_prepare(&repo_id, reset).await
}

// --- watcher ------------------------------------------------------------------------------------------------------------

#[tauri::command]
pub async fn watch_repo<R: Runtime>(window: WebviewWindow<R>, core: CoreState<'_>, repo_id: String) -> Result<()> {
    core.watch_repo(window.label(), &repo_id).await
}

#[tauri::command]
pub fn unwatch_repo<R: Runtime>(window: WebviewWindow<R>, core: CoreState<'_>, repo_id: String) {
    core.watchers.stop(window.label(), &repo_id);
}

// --- git (định vị) ------------------------------------------------------------------------------------------------------

async fn current_git(core: &Core) -> Result<GitInfo> {
    match core.locator.current() {
        Ok(info) => Ok((*info).clone()),
        Err(_) => core.locator.refresh().await.map(|info| (*info).clone()),
    }
}

#[tauri::command]
pub async fn git_locate(core: CoreState<'_>) -> Result<GitInfo> {
    current_git(&core).await
}

/// `path = None` → tự tìm; `Some` chỉ nhận ứng viên Rust đã tìm thấy (webview không trỏ git tới file tuỳ ý).
#[tauri::command]
pub async fn set_git_path(core: CoreState<'_>, path: Option<String>) -> Result<GitInfo> {
    let info = core.locator.set_path(path.as_deref()).await?;
    core.events.git_env_changed();
    Ok((*info).clone())
}

/// Chọn file git bằng hộp thoại native.
#[tauri::command]
pub async fn pick_git_path<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>, core: CoreState<'_>) -> Result<Option<GitInfo>> {
    let dialog = app.dialog().file().set_parent(&window).set_title(crate::locale::current(&app).texts().pick_git);
    let picked = tokio::task::spawn_blocking(move || dialog.blocking_pick_file()).await.map_err(join_error)?;
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| AppError::Io(format!("Đường dẫn đã chọn không hợp lệ: {e}")))?;
    let info = core.locator.set_picked(path).await?;
    core.events.git_env_changed();
    Ok(Some((*info).clone()))
}

// --- hệ điều hành -------------------------------------------------------------------------------------------------------

#[tauri::command]
pub async fn open_in_terminal(core: CoreState<'_>, repo_id: String) -> Result<()> {
    core.open_in_terminal(&repo_id).await
}

#[tauri::command]
pub async fn open_in_editor(core: CoreState<'_>, repo_id: String, path: Option<String>) -> Result<()> {
    core.open_in_editor(&repo_id, path.as_deref()).await
}

#[tauri::command]
pub async fn reveal(core: CoreState<'_>, repo_id: String, path: Option<String>) -> Result<()> {
    core.reveal(&repo_id, path.as_deref()).await
}

#[tauri::command]
pub async fn open_url(url: String, confirmed: Option<bool>) -> Result<()> {
    os_integration::open_url(&url, confirmed.unwrap_or(false)).await
}

/// Webview tải lại/đóng: huỷ op con của cửa sổ này và bỏ watcher của nó.
#[tauri::command]
pub fn session_reset<R: Runtime>(window: WebviewWindow<R>, core: CoreState<'_>) {
    core.reset_window(window.label());
}

// --- askpass (2b) -------------------------------------------------------------------------------------------------------

/// Webview trả lời hộp thoại hỏi mật khẩu/passphrase (`askpass-request`); `answer = null` = người dùng huỷ.
/// Lớp mỏng: `askpass::reply` kiểm `request_id` + cửa sổ gọi.
#[tauri::command]
pub fn askpass_reply<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>, request_id: String, answer: Option<String>) -> Result<()> {
    askpass::reply(&app, window.label(), &request_id, answer)
}

// --- tài khoản git -----------------------------------------------------------------------------------------------------

/// Danh sách tài khoản (không token) + tài khoản mặc định + các owner đã gán.
#[tauri::command]
pub fn accounts_list(core: CoreState<'_>) -> AccountsView {
    core.accounts.view()
}

/// Thêm tài khoản bằng Personal access token / app password: app kiểm token với API của máy chủ rồi mới lưu (Keychain).
#[tauri::command]
pub async fn accounts_add_token(core: CoreState<'_>, host: String, provider: Option<Provider>, token: String) -> Result<crate::accounts::Account> {
    core.accounts.add_token(&host, provider, &token).await
}

/// Bắt đầu đăng nhập bằng mã (OAuth device flow) → mã để người dùng nhập trên trang của máy chủ.
#[tauri::command]
pub async fn accounts_start_login(
    core: CoreState<'_>,
    host: String,
    provider: Option<Provider>,
    client_id: Option<String>,
) -> Result<DeviceCode> {
    core.accounts.start_login(&host, provider, client_id.as_deref()).await
}

/// Hỏi token cho phiên đăng nhập: `null` = người dùng chưa xác nhận (UI hỏi lại sau `interval` giây), có token thì lưu
/// tài khoản và trả login.
#[tauri::command]
pub async fn accounts_poll_login(core: CoreState<'_>, device_code: String) -> Result<Option<String>> {
    core.accounts.poll_login(&device_code).await
}

/// Đóng phiên đăng nhập (người dùng bấm Huỷ / đóng hộp thoại).
#[tauri::command]
pub fn accounts_cancel_login(core: CoreState<'_>, device_code: String) {
    core.accounts.cancel_login(&device_code);
}

#[tauri::command]
pub fn accounts_remove(core: CoreState<'_>, host: String, login: String) -> Result<AccountsView> {
    core.accounts.remove(&host, &login)?;
    Ok(core.accounts.view())
}

#[tauri::command]
pub fn accounts_set_default(core: CoreState<'_>, host: String, login: String) -> Result<AccountsView> {
    core.accounts.set_default(&host, &login)?;
    Ok(core.accounts.view())
}

/// Gán owner (user / tổ chức) cho một tài khoản — lệnh git tới repo của owner đó dùng đúng token.
#[tauri::command]
pub fn accounts_assign_owner(core: CoreState<'_>, host: String, owner: String, login: Option<String>) -> Result<AccountsView> {
    core.accounts.assign_owner(&host, &owner, login.as_deref())?;
    Ok(core.accounts.view())
}

/// Tên / email ghi vào cấu hình repo khi dùng tài khoản này cho commit.
#[tauri::command]
pub fn accounts_set_identity(core: CoreState<'_>, host: String, login: String, name: String, email: String) -> Result<AccountsView> {
    core.accounts.set_commit_identity(&host, &login, &name, &email)?;
    Ok(core.accounts.view())
}

/// Lưu Client ID của OAuth App cho device flow (rỗng = xoá, chỉ dán được token).
#[tauri::command]
pub fn accounts_set_client_id(core: CoreState<'_>, host: String, client_id: String) -> Result<AccountsView> {
    core.accounts.set_oauth_client_id(&host, &client_id)?;
    Ok(core.accounts.view())
}

/// Repo mà tài khoản này truy cập được (dùng cho hộp Clone).
#[tauri::command]
pub async fn accounts_repositories(core: CoreState<'_>, host: String, login: String) -> Result<Vec<ForgeRepository>> {
    let token = core
        .accounts
        .token(&host, &login)
        .ok_or_else(|| AppError::Auth(format!("Tài khoản {login} trên {host} chưa có token trong máy")))?;
    crate::forge::list_repositories(&host, core.accounts.provider_of(&host)?, &token, &login).await
}

// --- Pull Request / Merge Request --------------------------------------------------------------------------------------

/// Repo trên máy chủ mà ta tạo / đọc PR (thông tin này webview chỉ gửi, không sao chép được từ đâu khác).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoRef {
    host: String,
    provider: Option<Provider>,
    owner: String,
    repo: String,
}

/// Nội dung PR/MR cần tạo (webview gửi kèm `repoRef`).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewMergeRequest {
    host: String,
    provider: Option<Provider>,
    owner: String,
    repo: String,
    title: String,
    body: String,
    source_branch: String,
    target_branch: String,
    draft: bool,
}

#[tauri::command]
pub async fn forge_list_merge_requests(core: CoreState<'_>, repo: RepoRef) -> Result<Vec<ForgeMergeRequest>> {
    forge::list_for(&core.accounts, &repo.host, repo.provider, &repo.owner, &repo.repo).await
}

#[tauri::command]
pub async fn forge_create_merge_request(core: CoreState<'_>, request: NewMergeRequest) -> Result<ForgeMergeRequest> {
    forge::create(
        &core.accounts,
        &request.host,
        request.provider,
        &request.owner,
        &request.repo,
        &request.title,
        &request.body,
        &request.source_branch,
        &request.target_branch,
        request.draft,
    )
    .await
}

// --- cập nhật tự động + chế độ an toàn (8a) -----------------------------------------------------------------------------

/// Kiểm cập nhật theo kênh hiện tại: `null` = đang ở bản mới nhất.
#[tauri::command]
pub async fn update_check<R: Runtime>(app: AppHandle<R>) -> Result<Option<UpdateInfo>> {
    updater::check(&app).await
}

/// Tải + kiểm chữ ký + cài bản đã báo (tiến độ qua sự kiện `update-progress`).
#[tauri::command]
pub async fn update_install<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    updater::install(&app).await
}

/// Đổi kênh cập nhật (`"beta"` | `"stable"`; kênh lạ bị serde từ chối).
#[tauri::command]
pub fn update_set_channel<R: Runtime>(app: AppHandle<R>, channel: updater::Channel) -> Result<()> {
    updater::set_channel(&app, channel)
}

/// Ngôn ngữ giao diện (Cài đặt): Rust dùng cho tiêu đề hộp chọn thư mục và hộp "chế độ an toàn".
#[tauri::command]
pub fn app_set_locale<R: Runtime>(app: AppHandle<R>, locale: crate::locale::Locale) -> Result<()> {
    crate::locale::set(&app, locale)
}

/// Mở thêm một cửa sổ (Ctrl/⌘+T).
#[tauri::command]
pub fn new_window<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    crate::open_new_window(&app).map_err(|error| AppError::Internal(format!("mở cửa sổ mới: {error}")))
}

/// UI báo "đã sẵn sàng" → đặt lại bộ đếm khởi động hỏng của chế độ an toàn.
#[tauri::command]
pub fn app_ready<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    safe_mode::ready(&app)
}

/// Thời gian chờ PATH của login shell (macOS).
pub const LOGIN_PATH_TIMEOUT: Duration = Duration::from_secs(3);
