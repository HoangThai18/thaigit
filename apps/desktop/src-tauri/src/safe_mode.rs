//! Startup safe mode (phase 8a). `boot.json` in the data directory counts CONSECUTIVE failed startups: every app launch
//! increments the counter BEFORE loading the UI; once the UI is built it calls `app_ready` to reset it to 0. A broken
//! build whose UI never comes up cannot call `app_ready` — so the counting and the decision live in Rust.
//!
//! Failing ≥ `SAFE_MODE_AFTER` times in a row → report it with a native dialog and check for an update right away (the fix
//! shows up on the update bar once the UI loads; if it does not, the next launch checks again).
//!
//! Smoke test (CI): `THAIGIT_SMOKE_EXIT=1` → the app exits 0 right after the UI calls `app_ready`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use crate::errors::Result;
use crate::store;

pub const BOOT_FILE: &str = "boot.json";
/// Consecutive failed startups needed before safe mode turns on.
pub const SAFE_MODE_AFTER: u32 = 3;
pub const SMOKE_ENV: &str = "THAIGIT_SMOKE_EXIT";

#[derive(Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct BootRecord {
    failed_boots: u32,
}

pub struct SafeModeState {
    pub active: bool,
    path: PathBuf,
}

/// Record one startup (counted as failed until `ready`). Returns `true` when the earlier attempts already failed enough to enter safe mode.
pub fn begin_boot(data_dir: &Path) -> bool {
    let path = data_dir.join(BOOT_FILE);
    let previous = store::read_json::<BootRecord>(&path).map(|record| record.failed_boots).unwrap_or(0);
    // If it cannot be written (full disk, permissions), skip it: safe mode is only a safety net and must never stop the app from opening.
    let _ = store::write_json(&path, &BootRecord { failed_boots: previous.saturating_add(1) });
    previous >= SAFE_MODE_AFTER
}

/// Called in `setup` (after the data directory exists, before windows are built).
pub fn init<R: Runtime>(app: &AppHandle<R>, data_dir: &Path) {
    let active = begin_boot(data_dir);
    app.manage(SafeModeState { active, path: data_dir.join(BOOT_FILE) });
    if !active {
        return;
    }
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
    let texts = crate::locale::current(app).texts();
    app.dialog()
        .message(texts.safe_mode_message)
        .title(texts.safe_mode_title)
        .kind(MessageDialogKind::Warning)
        .show(|_| {});
    if !cfg!(debug_assertions) {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            // A network error stays silent — the updater's periodic check retries later.
            let _ = crate::updater::check(&handle).await;
        });
    }
}

/// `app_ready`: the UI is built → reset the counter. Safe to call more than once.
pub fn ready<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    if let Some(state) = app.try_state::<SafeModeState>() {
        let _ = store::write_json(&state.path, &BootRecord::default());
    }
    if std::env::var(SMOKE_ENV).is_ok_and(|value| value == "1") {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            // Let the UI run a little longer (catching an error right after mount) before exiting.
            tokio::time::sleep(Duration::from_secs(2)).await;
            handle.exit(0);
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_consecutive_failed_boots() {
        let dir = tempfile::tempdir().unwrap();
        // Three launches without the UI: the fourth enters safe mode.
        assert!(!begin_boot(dir.path()));
        assert!(!begin_boot(dir.path()));
        assert!(!begin_boot(dir.path()));
        assert!(begin_boot(dir.path()));
        let record: BootRecord = store::read_json(&dir.path().join(BOOT_FILE)).unwrap();
        assert_eq!(record.failed_boots, 4);
    }

    #[test]
    fn ready_resets_the_counter_and_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_app();
        for _ in 0..5 {
            begin_boot(dir.path());
        }
        app.manage(SafeModeState { active: true, path: dir.path().join(BOOT_FILE) });
        assert!(ready(app.handle()).is_ok());
        assert!(ready(app.handle()).is_ok());
        assert!(!begin_boot(dir.path()), "sau app_ready, lần mở kế tiếp không còn là chế độ an toàn");
    }

    #[test]
    fn ready_without_state_is_harmless() {
        let app = tauri::test::mock_app();
        assert!(ready(app.handle()).is_ok());
    }

    #[test]
    fn corrupt_boot_file_starts_from_zero() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(BOOT_FILE), b"{hong").unwrap();
        assert!(!begin_boot(dir.path()));
    }
}
