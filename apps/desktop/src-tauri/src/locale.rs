//! Ngôn ngữ giao diện cho vài chữ do chính Rust hiện (tiêu đề hộp chọn thư mục / file, hộp "chế độ an toàn" lúc khởi động
//! — lúc đó chưa có webview). Webview lưu lựa chọn qua `app_set_locale` vào `<data>/locale.json`; mặc định tiếng Việt.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use crate::errors::Result;
use crate::store;

const FILE: &str = "locale.json";

/// Khớp `Locale` của TypeScript (`'vi' | 'en'`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Locale {
    #[default]
    Vi,
    En,
}

/// Chữ Rust tự hiện, theo từng ngôn ngữ.
pub struct Texts {
    pub pick_folder: &'static str,
    pub pick_git: &'static str,
    pub pick_ssh_key: &'static str,
    pub safe_mode_title: &'static str,
    pub safe_mode_message: &'static str,
}

const VI: Texts = Texts {
    pick_folder: "Chọn thư mục",
    pick_git: "Chọn chương trình git",
    pick_ssh_key: "Chọn khoá SSH bí mật",
    safe_mode_title: "Thaigit — chế độ an toàn",
    safe_mode_message: "Thaigit đã không khởi động được vài lần liên tiếp. Thaigit đang kiểm tra bản sửa lỗi — nếu có, thanh cập \
                        nhật sẽ hiện ở đầu cửa sổ. Bạn vẫn dùng tiếp được.",
};

const EN: Texts = Texts {
    pick_folder: "Choose Folder",
    pick_git: "Choose the Git executable",
    pick_ssh_key: "Choose a Private SSH Key",
    safe_mode_title: "Thaigit — safe mode",
    safe_mode_message: "Thaigit failed to start several times in a row. It is checking for a fix — if there is one, the update \
                        bar will appear at the top of the window. You can keep using the app.",
};

impl Locale {
    pub fn texts(self) -> &'static Texts {
        match self {
            Self::Vi => &VI,
            Self::En => &EN,
        }
    }
}

#[derive(Serialize, Deserialize)]
struct Saved {
    locale: Locale,
}

pub struct LocaleState {
    current: Mutex<Locale>,
    path: PathBuf,
}

/// Đọc ngôn ngữ đã lưu (file thiếu / hỏng → tiếng Việt). Gọi trong `setup`, trước `safe_mode::init`.
pub fn init<R: Runtime>(app: &AppHandle<R>, data_dir: &Path) {
    let path = data_dir.join(FILE);
    let current = store::read_json::<Saved>(&path).map(|saved| saved.locale).unwrap_or_default();
    app.manage(LocaleState { current: Mutex::new(current), path });
}

/// Ngôn ngữ hiện tại (chưa `init` → tiếng Việt).
pub fn current<R: Runtime>(app: &AppHandle<R>) -> Locale {
    app.try_state::<LocaleState>()
        .map(|state| *state.current.lock().unwrap_or_else(|poisoned| poisoned.into_inner()))
        .unwrap_or_default()
}

/// `app_set_locale`: đổi và lưu bền.
pub fn set<R: Runtime>(app: &AppHandle<R>, locale: Locale) -> Result<()> {
    let Some(state) = app.try_state::<LocaleState>() else { return Ok(()) };
    *state.current.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = locale;
    store::write_json(&state.path, &Saved { locale })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locale_matches_the_typescript_wire_shape() {
        assert_eq!(serde_json::to_string(&Locale::En).unwrap(), "\"en\"");
        assert_eq!(serde_json::from_str::<Locale>("\"vi\"").unwrap(), Locale::Vi);
        assert!(serde_json::from_str::<Locale>("\"fr\"").is_err());
        assert_eq!(Locale::default(), Locale::Vi);
    }

    #[test]
    fn every_locale_has_all_texts() {
        for locale in [Locale::Vi, Locale::En] {
            let texts = locale.texts();
            for text in [texts.pick_folder, texts.pick_git, texts.pick_ssh_key, texts.safe_mode_title, texts.safe_mode_message] {
                assert!(!text.trim().is_empty());
            }
        }
        assert_ne!(Locale::Vi.texts().pick_folder, Locale::En.texts().pick_folder);
    }

    #[test]
    fn saved_file_round_trips_and_bad_files_fall_back_to_vietnamese() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE);
        store::write_json(&path, &Saved { locale: Locale::En }).unwrap();
        assert_eq!(store::read_json::<Saved>(&path).map(|saved| saved.locale), Some(Locale::En));
        std::fs::write(&path, "{\"locale\":\"xx\"}").unwrap();
        assert_eq!(store::read_json::<Saved>(&path).map(|saved| saved.locale).unwrap_or_default(), Locale::Vi);
    }
}
