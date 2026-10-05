//! IPC commands: a thin layer between the webview and `Core`. Command names match `Commands` in
//! `packages/contracts/src/ipc.ts` exactly.
//! The webview is untrusted: `Core` validates every parameter, and paths only ever come from Rust-issued tokens.

use std::sync::Arc;
use std::time::Duration;

use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request, Response};
use tauri::{AppHandle, Runtime, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::accounts::{AccountsView, Provider};
use crate::ssh_keys::SshKeysView;
use crate::core::{Core, GitExecRequest};
use crate::errors::{AppError, Result};
use crate::forge::{self, DeviceCode, ForgeMergeRequest, ForgePerson, ForgeRepository, PeopleRole};
use crate::exec::FrameSink;
use crate::health::RepoHealth;
use crate::locate::GitInfo;
use crate::os_integration;
use crate::rebase::{RebaseOutcome, RebaseStep};
use crate::related::RelatedKind;
use crate::registry::{OpenSource, OpenedRepo, PickedFolder, RecentRepo, new_detach_flag};
use crate::repo_fs;
use crate::typed::ConfigScope;
use crate::updater::UpdateInfo;
use crate::{askpass, safe_mode, updater};

type CoreState<'a> = State<'a, Arc<Core>>;

/// Put a frame on `Channel<InvokeResponseBody>` in Raw form (not through JSON).
struct ChannelSink(Channel<InvokeResponseBody>);

impl FrameSink for ChannelSink {
    fn send(&self, frame: Vec<u8>) {
        // The webview reloaded or closed: drop the frame; the git process is still awaited and cleaned up as usual.
        let _ = self.0.send(InvokeResponseBody::Raw(frame));
    }
}

fn join_error(error: tokio::task::JoinError) -> AppError {
    AppError::Internal(format!("Tác vụ nền lỗi: {error}"))
}

// MARK: - repo

/// Native folder picker; returns a token (not an arbitrary path) for `open_repo`/`git_clone`/`git_init` to use.
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

/// A folder the OS handed us at startup ("Open With", argv): read once, returned as a token.
#[tauri::command]
pub fn take_launch_paths<R: Runtime>(window: WebviewWindow<R>, core: CoreState<'_>) -> Vec<PickedFolder> {
    core.registry.take_launch_paths_for(window.label())
}

// MARK: - git

/// Runs git (already through the policy) and streams Raw `[tag|bytes]` frames on `channel`; the command returns `()` — TS only resolves once the exit frame arrives.
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
pub async fn git_rebase_interactive(
    core: CoreState<'_>,
    repo_id: String,
    onto: String,
    steps: Vec<RebaseStep>,
) -> Result<RebaseOutcome> {
    core.git_rebase_interactive(&repo_id, &onto, &steps).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn git_worktree_add(
    core: CoreState<'_>,
    repo_id: String,
    dest_token: String,
    name: String,
    branch: String,
    create_branch: bool,
    start: Option<String>,
) -> Result<String> {
    core.git_worktree_add(&repo_id, &dest_token, &name, &branch, create_branch, start.as_deref()).await
}

/// Open a worktree / submodule of an already-open repo in a new window (Rust verifies that git confirms the path).
#[tauri::command]
pub async fn open_related_repo<R: Runtime>(app: AppHandle<R>, core: CoreState<'_>, repo_id: String, kind: RelatedKind, path: String) -> Result<()> {
    let dir = core.related_repo_path(&repo_id, kind, &path).await?;
    let label = crate::next_window_label();
    core.registry.set_window_launch(&label, dir);
    crate::build_window(&app, &label).map_err(|error| AppError::Internal(format!("mở cửa sổ mới: {error}")))
}

#[tauri::command]
pub fn repo_health(core: CoreState<'_>, repo_id: String) -> Result<RepoHealth> {
    core.repo_health(&repo_id)
}

#[tauri::command]
pub fn remove_stale_lock(core: CoreState<'_>, repo_id: String, path: String) -> Result<()> {
    core.remove_stale_lock(&repo_id, &path)
}

/// A commit author's avatar as a data URL, so the graph canvas can draw it (the webview cannot reach the network itself).
/// `owner` / `repo` are the github.com repository of the opened repo (without them the GitHub API source is skipped);
/// Rust validates the characters and builds the URL. `None` when there is no image or it cannot be fetched — the UI
/// draws initials and needs no error.
#[tauri::command]
pub async fn avatar_lookup(
    core: CoreState<'_>,
    email: String,
    owner: Option<String>,
    repo: Option<String>,
) -> Result<Option<String>> {
    let target = crate::avatars::github_repo(owner.as_deref(), repo.as_deref());
    Ok(core.avatar(&email, target).await)
}

// MARK: - RepoFs

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

/// Byte-level file write: the request body is raw bytes (not JSON); the parameters are in the `x-repo-id`, `x-rel`
/// (percent-encoded), `x-expected-sha256` (hex; empty = the file must not exist) headers.
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

// MARK: - watcher

#[tauri::command]
pub async fn watch_repo<R: Runtime>(window: WebviewWindow<R>, core: CoreState<'_>, repo_id: String) -> Result<()> {
    core.watch_repo(window.label(), &repo_id).await
}

#[tauri::command]
pub fn unwatch_repo<R: Runtime>(window: WebviewWindow<R>, core: CoreState<'_>, repo_id: String) {
    core.watchers.stop(window.label(), &repo_id);
}

// MARK: - git (location)

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

/// `path = None` → search; `Some` only accepts candidates Rust already found (the webview cannot point git at an arbitrary file).
#[tauri::command]
pub async fn set_git_path(core: CoreState<'_>, path: Option<String>) -> Result<GitInfo> {
    let info = core.locator.set_path(path.as_deref()).await?;
    core.events.git_env_changed();
    Ok((*info).clone())
}

/// Pick the git executable with a native dialog.
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

// MARK: - operating system

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

/// The webview reloaded or closed: cancel this window's child operations and drop its watcher.
#[tauri::command]
pub fn session_reset<R: Runtime>(window: WebviewWindow<R>, core: CoreState<'_>) {
    core.reset_window(window.label());
}

// MARK: - askpass (2b)

/// The webview answers the password / passphrase prompt (`askpass-request`); `answer = null` = the user cancelled.
/// Thin layer: `askpass::reply` validates `request_id` + the calling window.
#[tauri::command]
pub fn askpass_reply<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>, request_id: String, answer: Option<String>) -> Result<()> {
    askpass::reply(&app, window.label(), &request_id, answer)
}

// MARK: - git accounts

/// Account list (no tokens) + the default account + the assigned owners.
#[tauri::command]
pub fn accounts_list(core: CoreState<'_>) -> AccountsView {
    core.accounts.view()
}

/// Add an account with a personal access token / app password: the app validates the token against the host's API before storing it (Keychain).
#[tauri::command]
pub async fn accounts_add_token(core: CoreState<'_>, host: String, provider: Option<Provider>, token: String) -> Result<crate::accounts::Account> {
    core.accounts.add_token(&host, provider, &token).await
}

/// Start a device-flow sign-in → the code the user types on the host's page.
#[tauri::command]
pub async fn accounts_start_login(
    core: CoreState<'_>,
    host: String,
    provider: Option<Provider>,
    client_id: Option<String>,
) -> Result<DeviceCode> {
    core.accounts.start_login(&host, provider, client_id.as_deref()).await
}

/// Poll for the token of a sign-in session: `null` = the user has not confirmed yet (the UI retries after `interval`
/// seconds); with a token the account is stored and its login returned.
#[tauri::command]
pub async fn accounts_poll_login(core: CoreState<'_>, device_code: String) -> Result<Option<String>> {
    core.accounts.poll_login(&device_code).await
}

/// Close a sign-in session (the user pressed Cancel or closed the dialog).
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

/// Assign an owner (user / organisation) to an account — git commands for that owner's repos then use the right token.
#[tauri::command]
pub fn accounts_assign_owner(core: CoreState<'_>, host: String, owner: String, login: Option<String>) -> Result<AccountsView> {
    core.accounts.assign_owner(&host, &owner, login.as_deref())?;
    Ok(core.accounts.view())
}

/// Name / email written into the repo config when this account is used for commits.
#[tauri::command]
pub fn accounts_set_identity(core: CoreState<'_>, host: String, login: String, name: String, email: String) -> Result<AccountsView> {
    core.accounts.set_commit_identity(&host, &login, &name, &email)?;
    Ok(core.accounts.view())
}

/// Store an OAuth App client id for device flow (empty = clear it, so only pasted tokens work).
#[tauri::command]
pub fn accounts_set_client_id(core: CoreState<'_>, host: String, client_id: String) -> Result<AccountsView> {
    core.accounts.set_oauth_client_id(&host, &client_id)?;
    Ok(core.accounts.view())
}

// MARK: - in-app terminal

type TerminalsState<'a> = State<'a, Arc<crate::terminal::Terminals>>;

/// Open a terminal in the root directory of repo `repo_id` (the webview cannot choose another program or directory).
#[tauri::command]
pub fn terminal_open<R: Runtime>(
    window: WebviewWindow<R>,
    core: CoreState<'_>,
    terminals: TerminalsState<'_>,
    repo_id: String,
    cols: u16,
    rows: u16,
    channel: Channel<crate::terminal::TerminalEvent>,
) -> Result<String> {
    let entry = core.registry.get(&repo_id)?;
    terminals.open(window.label(), &entry.root, cols, rows, core.locator.path_env(), move |event| {
        let _ = channel.send(event);
    })
}

#[tauri::command]
pub fn terminal_write<R: Runtime>(window: WebviewWindow<R>, terminals: TerminalsState<'_>, id: String, data: String) -> Result<()> {
    if data.len() > 64 * 1024 {
        return Err(AppError::Policy("Dữ liệu gõ vào terminal quá lớn".into()));
    }
    terminals.write(window.label(), &id, &data)
}

#[tauri::command]
pub fn terminal_resize<R: Runtime>(window: WebviewWindow<R>, terminals: TerminalsState<'_>, id: String, cols: u16, rows: u16) -> Result<()> {
    terminals.resize(window.label(), &id, cols, rows)
}

#[tauri::command]
pub fn terminal_close<R: Runtime>(window: WebviewWindow<R>, terminals: TerminalsState<'_>, id: String) {
    terminals.close(window.label(), &id);
}

// --- khoá SSH ------------------------------------------------------------------------------------------------------------

#[tauri::command]
pub fn ssh_keys_list(core: CoreState<'_>) -> SshKeysView {
    core.ssh_keys.view()
}

/// Create a new Ed25519 key (the secret goes into the OS keystore).
#[tauri::command]
pub fn ssh_keys_generate(core: CoreState<'_>, name: String) -> Result<SshKeysView> {
    let host = hostname_label();
    core.ssh_keys.generate(&name, &format!("thaigit@{host}"))?;
    Ok(core.ssh_keys.view())
}

/// Import an existing key: Rust opens the file picker itself (the webview sends no path) and reads the key plus its `.pub` file when present.
#[tauri::command]
pub async fn ssh_keys_import<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>, core: CoreState<'_>) -> Result<Option<SshKeysView>> {
    let mut dialog = app.dialog().file().set_parent(&window).set_title(crate::locale::current(&app).texts().pick_ssh_key);
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        dialog = dialog.set_directory(std::path::PathBuf::from(home).join(".ssh"));
    }
    let picked = tokio::task::spawn_blocking(move || dialog.blocking_pick_file()).await.map_err(join_error)?;
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| AppError::Io(format!("Đường dẫn đã chọn không hợp lệ: {e}")))?;
    let metadata = std::fs::metadata(&path).map_err(|e| AppError::Io(format!("Không đọc được file khoá: {e}")))?;
    if metadata.len() > 32 * 1024 {
        return Err(AppError::Policy("File này không phải khoá SSH bí mật — hãy chọn file khoá bí mật (vd. id_ed25519)".into()));
    }
    let private_key = std::fs::read_to_string(&path).map_err(|e| AppError::Io(format!("Không đọc được file khoá: {e}")))?;
    let mut pub_path = path.clone().into_os_string();
    pub_path.push(".pub");
    let public = std::fs::read_to_string(std::path::PathBuf::from(pub_path)).ok();
    let name = path.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "SSH".into());
    core.ssh_keys.import(&name, &private_key, public.as_deref())?;
    Ok(Some(core.ssh_keys.view()))
}

#[tauri::command]
pub fn ssh_keys_rename(core: CoreState<'_>, id: String, name: String) -> Result<SshKeysView> {
    core.ssh_keys.rename(&id, &name)
}

#[tauri::command]
pub fn ssh_keys_remove(core: CoreState<'_>, id: String) -> Result<SshKeysView> {
    core.ssh_keys.remove(&id)
}

#[tauri::command]
pub fn ssh_keys_set_enabled(core: CoreState<'_>, enabled: bool) -> Result<SshKeysView> {
    core.ssh_keys.set_enabled(enabled)
}

/// Upload the public key to the `login` account on `host`. Without the required scope the webview copies the key and opens the "add key" page.
#[tauri::command]
pub async fn ssh_keys_upload(core: CoreState<'_>, id: String, host: String, login: String) -> Result<SshUploadResult> {
    let key = core.ssh_keys.public_key(&id).ok_or_else(|| AppError::NotFound("Không tìm thấy khoá SSH này".into()))?;
    let provider = core.accounts.provider_of(&host)?;
    let page = forge::ssh_keys_page(&host, provider);
    core.accounts.refresh_due(&host).await;
    let Some(token) = core.accounts.token(&host, &login) else {
        return Ok(SshUploadResult { outcome: forge::SshKeyUpload::MissingScope, page });
    };
    let outcome = forge::add_ssh_key(&host, provider, &token, &format!("Thaigit — {}", key.name), &key.public_key).await?;
    Ok(SshUploadResult { outcome, page })
}

/// Result of the upload + the manual "add key" page (used when the scope is missing).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshUploadResult {
    outcome: forge::SshKeyUpload,
    page: String,
}

/// `ssh -T git@<host>` with exactly Thaigit's keys (a temporary agent), asking nothing. Returns the translated greeting.
#[tauri::command]
pub async fn ssh_keys_test(core: CoreState<'_>, host: String) -> Result<String> {
    let host = host.trim().to_ascii_lowercase();
    if !crate::accounts::valid_host(&host) {
        return Err(AppError::Policy("Địa chỉ máy chủ không hợp lệ".into()));
    }
    let keys = core.ssh_keys.private_keys();
    if keys.is_empty() {
        return Err(AppError::Policy("Chưa có khoá SSH nào đang bật".into()));
    }
    let git = core.locator.current()?;
    let dirs = core.locator.search_dirs();
    let git_path = std::path::PathBuf::from(&git.path);
    let tool = |name: &str| {
        crate::ssh_keys::find_tool(name, &git_path, &dirs)
            .ok_or_else(|| AppError::Io("Không chạy được ssh-agent nên chưa dùng được khoá SSH của Thaigit".into()))
    };
    let (agent, add, ssh) = (tool("ssh-agent")?, tool("ssh-add")?, tool("ssh")?);
    let env: Vec<(std::ffi::OsString, std::ffi::OsString)> = std::env::vars_os().collect();
    let output = tokio::task::spawn_blocking(move || -> Result<String> {
        let session = crate::ssh_keys::SshAgent::start(&agent, &add, &keys, &env)?;
        let mut command = std::process::Command::new(ssh);
        command.args(["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=15"]);
        command.arg(format!("git@{host}"));
        command.env("SSH_AUTH_SOCK", session.socket()).stdin(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        let output = command.output().map_err(|_| AppError::Io("Không chạy được ssh".into()))?;
        let text = format!("{}\n{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
        crate::ssh_keys::connection_message(&text, &host).map_err(AppError::Auth)
    })
    .await
    .map_err(join_error)??;
    Ok(output)
}

fn hostname_label() -> String {
    let raw = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "may".into());
    let clean: String = raw.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    if clean.is_empty() { "may".into() } else { clean.to_ascii_lowercase() }
}

/// Repos this account can access (for the Clone dialog).
#[tauri::command]
pub async fn accounts_repositories(core: CoreState<'_>, host: String, login: String) -> Result<Vec<ForgeRepository>> {
    core.accounts.refresh_due(&host).await;
    let token = core
        .accounts
        .token(&host, &login)
        .ok_or_else(|| AppError::Auth(format!("Tài khoản {login} trên {host} chưa có token trong máy")))?;
    crate::forge::list_repositories(&host, core.accounts.provider_of(&host)?, &token, &login).await
}

// --- Pull Request / Merge Request --------------------------------------------------------------------------------------

/// The server repository we create/read PRs for (the webview only sends this; it cannot be derived from anything else).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoRef {
    host: String,
    provider: Option<Provider>,
    owner: String,
    repo: String,
}

/// The PR / MR content to create (the webview sends it with `repoRef`).
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

/// Users who can be assigned to the repo's PRs / MRs (GitHub `assignees`, GitLab project members).
#[tauri::command]
pub async fn forge_list_assignable(core: CoreState<'_>, repo: RepoRef) -> Result<Vec<ForgePerson>> {
    forge::assignable_for(&core.accounts, &repo.host, repo.provider, &repo.owner, &repo.repo).await
}

/// Replace the reviewers or assignees of a PR / MR; returns the PR / MR re-read from the server.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPeopleRequest {
    host: String,
    provider: Option<Provider>,
    owner: String,
    repo: String,
    number: String,
    role: PeopleRole,
    people: Vec<ForgePerson>,
}

#[tauri::command]
pub async fn forge_set_people(core: CoreState<'_>, request: SetPeopleRequest) -> Result<ForgeMergeRequest> {
    forge::set_people_for(
        &core.accounts,
        &request.host,
        request.provider,
        &request.owner,
        &request.repo,
        &request.number,
        request.role,
        &request.people,
    )
    .await
}

// MARK: - Auto-update and safe mode (8a)

/// Check for an update on the current channel: `null` = already up to date.
#[tauri::command]
pub async fn update_check<R: Runtime>(app: AppHandle<R>) -> Result<Option<UpdateInfo>> {
    updater::check(&app).await
}

/// Download + verify the signature + install the reported version (progress via the `update-progress` event).
#[tauri::command]
pub async fn update_install<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    updater::install(&app).await
}

/// Switch the update channel (`"beta"` | `"stable"`; an unknown channel is rejected by serde).
#[tauri::command]
pub fn update_set_channel<R: Runtime>(app: AppHandle<R>, channel: updater::Channel) -> Result<()> {
    updater::set_channel(&app, channel)
}

/// UI language (Settings): Rust uses it for the folder-picker title and the "safe mode" dialog.
#[tauri::command]
pub fn app_set_locale<R: Runtime>(app: AppHandle<R>, locale: crate::locale::Locale) -> Result<()> {
    crate::locale::set(&app, locale)
}

/// Open an extra window (Ctrl/⌘+T).
#[tauri::command]
pub fn new_window<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    crate::open_new_window(&app).map_err(|error| AppError::Internal(format!("mở cửa sổ mới: {error}")))
}

/// The UI reports "ready" → reset the safe-mode failed-start counter.
#[tauri::command]
pub fn app_ready<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    safe_mode::ready(&app)
}

/// How long to wait for the login shell's PATH (macOS).
pub const LOGIN_PATH_TIMEOUT: Duration = Duration::from_secs(3);
