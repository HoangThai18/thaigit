//! Cập nhật tự động: `tauri-plugin-updater` kiểm `latest.json` của kênh (release cố định `desktop-<kênh>` trên GitHub), chữ ký
//! minisign của bản cài kiểm bằng khoá công khai trong `tauri.conf.json` (`requireSignedVersion`: phiên bản ghi trong chữ ký phải
//! khớp manifest — không tráo được bản cũ có chữ ký thật vào số phiên bản mới). Kiểm lúc khởi động (sau 20 giây) rồi mỗi 6 giờ, có
//! bản mới thì phát `update-available`; cài khi người dùng bấm (chờ các lệnh git đang chạy xong), phát `update-progress`.
//! Webview chỉ gọi `update_check` / `update_install` / `update_set_channel` và nghe sự kiện — kênh nào, bản nào hợp lệ, khi nào
//! cài đều quyết ở đây. Plugin KHÔNG được cấp quyền cho webview (capability không có `updater:*`).

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

/// Nơi đặt manifest: `<RELEASES>/desktop-<kênh>/latest.json`.
const RELEASES: &str = "https://github.com/HoangThai18/thaigit/releases/download";
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(20);
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// Chờ tối đa chừng này cho các lệnh git đang chạy xong trước khi cài (cài giữa lúc git ghi có thể để lại index.lock).
const IDLE_WAIT: Duration = Duration::from_secs(30);
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// Kênh cập nhật: manifest `latest.json` nằm trên release cố định `desktop-<kênh>` của GitHub.
/// Chuỗi serde khớp `UpdateChannel` ở TS (`'beta' | 'stable'`).
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

    /// Bản đang chạy là bản thử (`2.0.0-beta.1`) thì mặc định kênh beta, không thì stable.
    fn default_for(version: &semver::Version) -> Self {
        if version.pre.is_empty() { Self::Stable } else { Self::Beta }
    }
}

pub fn endpoint(channel: Channel) -> url::Url {
    url::Url::parse(&format!("{RELEASES}/desktop-{}/latest.json", channel.as_str())).expect("URL manifest hợp lệ")
}

/// Một bản cập nhật hợp lệ (đã qua chữ ký + chống hạ cấp). Khớp `UpdateInfo` ở TS (camelCase).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub version: String,
    /// Ghi chú phát hành (văn bản thường).
    pub notes: Option<String>,
    /// RFC 3339.
    pub pub_date: Option<String>,
}

#[derive(Clone, Serialize)]
struct UpdateAvailableEvent {
    update: UpdateInfo,
}

/// Khớp `UpdateProgressEvent` ở TS.
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
    /// Bản `check` vừa báo — `install` cài đúng bản này (người dùng đã thấy số phiên bản).
    pending: tokio::sync::Mutex<Option<Update>>,
    installing: AtomicBool,
    saved_path: Option<PathBuf>,
}

/// State của updater (có sau `init`). App dựng không qua `setup` (test IPC) thì báo lỗi thay vì panic.
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

/// Khởi tạo lúc `setup` (sau `app.manage(core)`): đăng ký plugin updater, đọc kênh đã lưu, bắt đầu vòng kiểm định kỳ (chỉ ở
/// bản build release — bản dev không tự kiểm).
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
                // Lỗi mạng khi tự kiểm thì im lặng; lần sau thử lại.
                let _ = check(&handle).await;
                tokio::time::sleep(CHECK_INTERVAL).await;
            }
        });
    }
    Ok(())
}

/// `update_check`: kiểm manifest của kênh hiện tại. `Ok(None)` = đang ở bản mới nhất; `Ok(Some)` = có bản hợp lệ
/// (và phát thêm `update-available`).
pub async fn check<R: Runtime>(app: &AppHandle<R>) -> Result<Option<UpdateInfo>> {
    let state = state(app)?;
    let channel = *state.channel.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint(channel)])
        .map_err(updater_error)?
        // Chỉ nhận bản MỚI HƠN (không bao giờ hạ cấp, kể cả khi manifest ghi số nhỏ hơn).
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

/// Chờ các lệnh git đang chạy (mọi repo) xong, tối đa `IDLE_WAIT`.
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

/// `update_install`: tải + kiểm chữ ký + cài bản đã báo bởi `check`, phát `update-progress`. Windows: trình cài NSIS chạy và
/// app tự thoát; macOS/Linux: cài xong thì khởi động lại.
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
    // `download` kiểm chữ ký minisign trước khi trả byte; sai chữ ký thì lỗi, không cài gì.
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
            // Giữ lại bản đã báo để người dùng bấm thử lại.
            *state.pending.lock().await = Some(update);
            return Err(updater_error(error));
        }
    };
    emit_progress(app, "installing", bytes.len() as u64, Some(bytes.len() as u64), None);
    update.install(bytes).map_err(updater_error)?;
    emit_progress(app, "ready", 0, None, None);
    app.restart();
}

/// `update_set_channel`: đổi kênh (lưu bền). Bản đã báo của kênh cũ bị bỏ — UI kiểm lại nếu muốn.
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
        // Kênh mặc định theo phiên bản trong tauri.conf.json (bản thử → beta, bản chính thức → ổn định); đổi kênh thì lưu bền.
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
