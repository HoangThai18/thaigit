//! Auto-update: `tauri-plugin-updater` fetches the channel's `latest.json` (from the fixed `desktop-<channel>` GitHub
//! release), and the installed build verifies its minisign signature with the public key in `tauri.conf.json`
//! (`requireSignedVersion`: the version recorded in the signature must match the manifest, so an old signed build cannot be
//! swapped for a newer version number). It checks at startup (after 20 seconds) and every 6 hours, emits
//! `update-available` when there is a new version, and installs when the user clicks (waiting for running git commands
//! to finish), emitting `update-progress`.
//! The webview only calls `update_check` / `update_install` / `update_set_channel` and listens for events — which channel
//! is current, which version is valid and when to install are all decided here. The plugin is NOT granted to the webview
//! (the capability has no `updater:*`).

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::core::Core;
use crate::errors::{AppError, Result};
use crate::store;

/// Where the manifest lives: `<RELEASES>/desktop-<channel>/latest.json`.
const RELEASES: &str = "https://github.com/HoangThai18/thaigit/releases/download";
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(20);
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// Wait at most this long for running git commands before installing (installing mid-write can leave an index.lock).
const IDLE_WAIT: Duration = Duration::from_secs(30);
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// Update channel: the `latest.json` manifest lives on the fixed `desktop-<channel>` GitHub release.
/// serde string matching TS's `UpdateChannel` (`'beta' | 'stable'`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Beta,
    Stable,
}

impl Channel {
    fn as_str(self) -> &'static str {
        match self {
            Self::Beta => "beta",
            Self::Stable => "stable",
        }
    }

    /// A prerelease build (`2.0.0-beta.1`) defaults to the beta channel, otherwise stable.
    fn default_for(version: &semver::Version) -> Self {
        if version.pre.is_empty() { Self::Stable } else { Self::Beta }
    }
}

pub fn endpoint(channel: Channel) -> url::Url {
    url::Url::parse(&format!("{RELEASES}/desktop-{}/latest.json", channel.as_str())).expect("URL manifest hợp lệ")
}

/// A valid update (signature and downgrade protection already verified). Matches TS's `UpdateInfo` (camelCase).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub version: String,
    /// Release notes (plain text).
    pub notes: Option<String>,
    /// RFC 3339.
    pub pub_date: Option<String>,
}

#[derive(Clone, Serialize)]
struct UpdateAvailableEvent {
    update: UpdateInfo,
}

/// Matches TS's `UpdateProgressEvent`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProgressEvent {
    phase: &'static str,
    downloaded: u64,
    total: Option<u64>,
    message: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct SavedChannel {
    channel: Channel,
}

struct UpdaterState {
    channel: std::sync::Mutex<Channel>,
    /// The update the last `check` reported — `install` installs exactly this one (the user already saw the version).
    pending: tokio::sync::Mutex<Option<Update>>,
    installing: AtomicBool,
    saved_path: Option<PathBuf>,
}

/// Updater state (present after `init`). An app built without going through `setup` (IPC tests) reports an error instead of panicking.
fn state<R: Runtime>(app: &AppHandle<R>) -> Result<tauri::State<'_, UpdaterState>> {
    app.try_state::<UpdaterState>().ok_or_else(|| AppError::Internal("Bộ cập nhật chưa khởi tạo.".into()))
}

fn updater_error(error: tauri_plugin_updater::Error) -> AppError {
    AppError::Io(format!("Cập nhật: {error}"))
}

fn current_version<R: Runtime>(app: &AppHandle<R>) -> semver::Version {
    semver::Version::parse(&app.package_info().version.to_string()).unwrap_or_else(|_| semver::Version::new(0, 0, 0))
}

fn info_of(update: &Update) -> UpdateInfo {
    UpdateInfo {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        notes: update.body.clone().filter(|body| !body.trim().is_empty()),
        pub_date: update.date.and_then(|date| date.format(&time::format_description::well_known::Rfc3339).ok()),
    }
}

/// Set up during `setup` (after `app.manage(core)`): register the updater plugin, read the saved channel, start the periodic
/// check (release builds only — a dev build never self-updates).
pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    app.plugin(tauri_plugin_updater::Builder::new().build()).map_err(|error| AppError::Internal(format!("updater: {error}")))?;
    let saved_path = app.path().app_data_dir().ok().map(|dir| dir.join("update-channel.json"));
    let channel = saved_path
        .as_deref()
        .and_then(store::read_json::<SavedChannel>)
        .map(|saved| saved.channel)
        .unwrap_or_else(|| Channel::default_for(&current_version(app)));
    app.manage(UpdaterState {
        channel: std::sync::Mutex::new(channel),
        pending: tokio::sync::Mutex::new(None),
        installing: AtomicBool::new(false),
        saved_path,
    });
    if !cfg!(debug_assertions) {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(FIRST_CHECK_DELAY).await;
            loop {
                // A network error during the automatic check is silent; the next round retries.
                let _ = check(&handle).await;
                tokio::time::sleep(CHECK_INTERVAL).await;
            }
        });
    }
    Ok(())
}

/// `update_check`: fetch the manifest of the current channel. `Ok(None)` = already up to date; `Ok(Some)` = a valid update
/// exists (and `update-available` is emitted as well).
pub async fn check<R: Runtime>(app: &AppHandle<R>) -> Result<Option<UpdateInfo>> {
    let state = state(app)?;
    let channel = *state.channel.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint(channel)])
        .map_err(updater_error)?
        // Only accept a NEWER version (never downgrade, even if the manifest lists a lower number).
        .version_comparator(|current, release| release.version > current)
        .build()
        .map_err(updater_error)?;
    let update = updater.check().await.map_err(updater_error)?;
    let mut pending = state.pending.lock().await;
    match update {
        None => {
            *pending = None;
            Ok(None)
        }
        Some(update) => {
            let info = info_of(&update);
            *pending = Some(update);
            let _ = app.emit("update-available", UpdateAvailableEvent { update: info.clone() });
            Ok(Some(info))
        }
    }
}

fn emit_progress<R: Runtime>(app: &AppHandle<R>, phase: &'static str, downloaded: u64, total: Option<u64>, message: Option<String>) {
    let _ = app.emit("update-progress", UpdateProgressEvent { phase, downloaded, total, message });
}

/// Wait for running git commands (all repos) to finish, at most `IDLE_WAIT`.
async fn wait_for_git_idle<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let Some(core) = app.try_state::<Arc<Core>>() else { return Ok(()) };
    let deadline = Instant::now() + IDLE_WAIT;
    while !core.ops.is_empty() {
        if Instant::now() > deadline {
            return Err(AppError::Busy("Đang chạy lệnh git — hãy thử cài lại sau khi thao tác xong.".into()));
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Ok(())
}

/// `update_install`: download + verify the signature + install the update reported by `check`, emitting `update-progress`.
/// On Windows the NSIS installer runs and the app exits itself; on macOS/Linux the app restarts after installing.
pub async fn install<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let state = state(app)?;
    if state.installing.swap(true, Ordering::SeqCst) {
        return Err(AppError::Busy("Đang cài bản cập nhật.".into()));
    }
    let result = install_pending(app, &state).await;
    state.installing.store(false, Ordering::SeqCst);
    if let Err(error) = &result {
        emit_progress(app, "failed", 0, None, Some(error.to_string()));
    }
    result
}

async fn install_pending<R: Runtime>(app: &AppHandle<R>, state: &UpdaterState) -> Result<()> {
    let update = state.pending.lock().await.take();
    let Some(update) = update else {
        return Err(AppError::NotFound("Chưa có bản cập nhật nào — hãy kiểm tra cập nhật trước.".into()));
    };
    wait_for_git_idle(app).await?;
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now() - PROGRESS_INTERVAL;
    let progress_app = app.clone();
    let verify_app = app.clone();
    emit_progress(app, "downloading", 0, None, None);
    // `download` verifies the minisign signature before returning any byte; a bad signature is an error and installs nothing.
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                if last_emit.elapsed() >= PROGRESS_INTERVAL {
                    last_emit = Instant::now();
                    emit_progress(&progress_app, "downloading", downloaded, total, None);
                }
            },
            || emit_progress(&verify_app, "verifying", 0, None, None),
        )
        .await;
    let bytes = match bytes {
        Ok(bytes) => bytes,
        Err(error) => {
            // Keep the reported update so the user can click Retry.
            *state.pending.lock().await = Some(update);
            return Err(updater_error(error));
        }
    };
    emit_progress(app, "installing", bytes.len() as u64, Some(bytes.len() as u64), None);
    update.install(bytes).map_err(updater_error)?;
    emit_progress(app, "ready", 0, None, None);
    app.restart();
}

/// `update_set_channel`: switch channel (persisted). A previously reported update of the old channel is dropped — the UI
/// re-checks if it wants one.
pub fn set_channel<R: Runtime>(app: &AppHandle<R>, channel: Channel) -> Result<()> {
    let state = state(app)?;
    *state.channel.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = channel;
    if let Ok(mut pending) = state.pending.try_lock() {
        *pending = None;
    }
    if let Some(path) = &state.saved_path {
        store::write_json(path, &SavedChannel { channel })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_and_info_match_the_typescript_wire_shapes() {
        assert_eq!(serde_json::to_value(Channel::Beta).unwrap(), serde_json::json!("beta"));
        assert_eq!(serde_json::from_str::<Channel>("\"stable\"").unwrap(), Channel::Stable);
        assert!(serde_json::from_str::<Channel>("\"nightly\"").is_err(), "kênh lạ bị từ chối");
        let info = UpdateInfo { current_version: "2.0.0".into(), version: "2.0.1".into(), notes: None, pub_date: Some("2026-12-01T00:00:00Z".into()) };
        assert_eq!(
            serde_json::to_value(info).unwrap(),
            serde_json::json!({ "currentVersion": "2.0.0", "version": "2.0.1", "notes": null, "pubDate": "2026-12-01T00:00:00Z" })
        );
        let progress = UpdateProgressEvent { phase: "downloading", downloaded: 10, total: None, message: None };
        assert_eq!(
            serde_json::to_value(progress).unwrap(),
            serde_json::json!({ "phase": "downloading", "downloaded": 10, "total": null, "message": null })
        );
    }

    #[test]
    fn endpoints_point_at_the_fixed_channel_releases() {
        assert_eq!(endpoint(Channel::Beta).as_str(), "https://github.com/HoangThai18/thaigit/releases/download/desktop-beta/latest.json");
        assert_eq!(endpoint(Channel::Stable).as_str(), "https://github.com/HoangThai18/thaigit/releases/download/desktop-stable/latest.json");
    }

    #[test]
    fn prerelease_builds_default_to_the_beta_channel() {
        assert_eq!(Channel::default_for(&semver::Version::parse("2.0.0-beta.1").unwrap()), Channel::Beta);
        assert_eq!(Channel::default_for(&semver::Version::parse("2.0.0").unwrap()), Channel::Stable);
    }

    #[test]
    fn the_plugin_starts_with_the_real_config_and_keeps_the_channel() {
        let data = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_builder().build(crate::app_context()).expect("app giả");
        init(app.handle()).expect("plugin updater nhận cấu hình trong tauri.conf.json");
        // Default channel follows the version in tauri.conf.json (prerelease → beta, release → stable); a chosen channel persists.
        let expected = Channel::default_for(&current_version(app.handle()));
        assert_eq!(*state(app.handle()).unwrap().channel.lock().unwrap(), expected);
        let path = data.path().join("update-channel.json");
        store::write_json(&path, &SavedChannel { channel: Channel::Stable }).unwrap();
        assert_eq!(store::read_json::<SavedChannel>(&path).map(|saved| saved.channel), Some(Channel::Stable));
    }

    #[test]
    fn the_public_key_in_the_config_is_a_minisign_key() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let pubkey = config["plugins"]["updater"]["pubkey"].as_str().expect("có khoá công khai");
        use base64::Engine as _;
        let decoded = base64::engine::general_purpose::STANDARD.decode(pubkey).expect("base64");
        let text = String::from_utf8(decoded).expect("utf-8");
        assert!(text.starts_with("untrusted comment: minisign public key"), "{text}");
        assert_eq!(config["bundle"]["createUpdaterArtifacts"], serde_json::json!(true));
        assert_eq!(config["plugins"]["updater"]["requireSignedVersion"], serde_json::json!(true));
    }
}
