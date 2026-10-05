//! Ảnh đại diện thật của người commit (như GitKraken), dùng cho node graph.
//!
//! Webview không tự gọi mạng được (CSP chỉ mở `ipc:`), nên Rust tải ảnh rồi trả về **data URL** — `img-src` có
//! `data:` nên canvas vẽ được. Thứ tự nguồn giống app macOS (`AvatarFetcher` của NhanhCore): email ẩn GitHub →
//! Gravatar; không nguồn nào có ảnh thì ghi một dấu "không có" để khỏi hỏi lại trong phiên.
//!
//! Chỉ nhận ảnh PNG/JPEG/GIF/WebP (đoán từ byte đầu, không tin `Content-Type`): data URL của SVG có thể mang
//! script, không để lọt vào webview dù CSP đã khoá.

use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use sha2::{Digest, Sha256};

/// Cạnh ảnh tải về (px) — node graph nhỏ hơn nhiều, phần dư cho màn hình Retina.
pub const AVATAR_SIZE: u32 = 80;
/// Ảnh tải về giữ một tuần; dấu "không có ảnh" giữ ba ngày (hết thì thử lại, thường là vừa đổi ảnh).
const IMAGE_LIFETIME: Duration = Duration::from_secs(7 * 24 * 3600);
const MISSING_LIFETIME: Duration = Duration::from_secs(3 * 24 * 3600);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const USER_AGENT: &str = "Thaigit";

/// Email đã chuẩn hoá (bỏ khoảng trắng, lowercase) — khoá cache và mã Gravatar đều tính từ đây.
pub fn normalize(email: &str) -> String {
    email.trim().to_lowercase()
}

/// SHA-256 của email đã chuẩn hoá, dạng hex: tên file cache và mã Gravatar (như `AvatarSource.hash` của Swift).
pub fn hash(email: &str) -> String {
    let digest = Sha256::digest(normalize(email).as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Email ẩn của GitHub: `12345+ten@users.noreply.github.com` → `(Some(12345), "ten")`;
/// `ten@users.noreply.github.com` → `(None, "ten")`.
pub fn github_noreply(email: &str) -> Option<(Option<u64>, String)> {
    let normalized = normalize(email);
    let suffix = "@users.noreply.github.com";
    let local = normalized.strip_suffix(suffix)?;
    match local.split_once('+') {
        Some((id, login)) if !login.is_empty() && id.parse::<u64>().is_ok() => Some((id.parse().ok(), login.to_string())),
        Some(_) => None,
        None if !local.is_empty() => Some((None, local.to_string())),
        None => None,
    }
}

/// Ảnh trên `avatars.githubusercontent.com` (có id) hoặc trang hồ sơ (chỉ có login).
pub fn github_avatar_url(id: Option<u64>, login: &str, size: u32) -> Option<String> {
    if let Some(id) = id {
        return Some(format!("https://avatars.githubusercontent.com/u/{id}?s={size}&v=4"));
    }
    if login.is_empty() {
        return None;
    }
    let encoded = percent_encoding::utf8_percent_encode(login, percent_encoding::NON_ALPHANUMERIC).to_string();
    Some(format!("https://github.com/{encoded}.png?size={size}"))
}

/// `d=404`: không có ảnh thì máy chủ trả 404 (không trả ảnh mặc định) để app vẽ chữ viết tắt.
pub fn gravatar_url(email: &str, size: u32) -> Option<String> {
    if !normalize(email).contains('@') {
        return None;
    }
    Some(format!("https://gravatar.com/avatar/{}?s={size}&d=404", hash(email)))
}

/// Danh sách URL thử theo thứ tự ưu tiên.
pub fn sources(email: &str, size: u32) -> Vec<String> {
    let mut result = Vec::new();
    if let Some((id, login)) = github_noreply(email)
        && let Some(url) = github_avatar_url(id, &login, size)
    {
        result.push(url);
    }
    if let Some(url) = gravatar_url(email, size) {
        result.push(url);
    }
    result
}

/// Định dạng ảnh đoán từ byte đầu. Không nhận SVG (mang script) hay định dạng lạ — bỏ thì vẽ chữ viết tắt.
fn sniff_mime(data: &[u8]) -> Option<&'static str> {
    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    const GIF: &[u8] = b"GIF87a";
    const GIF2: &[u8] = b"GIF89a";
    if data.starts_with(PNG) {
        Some("image/png")
    } else if data.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if data.starts_with(GIF) || data.starts_with(GIF2) {
        Some("image/gif")
    } else if data.len() > 12 && data.starts_with(b"RIFF") && &data[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// Kết quả đọc cache đĩa cho một email.
enum Cache {
    Image(Vec<u8>),
    /// Cờ "đã hỏi cả hai nguồn, không có ảnh" (file rỗng).
    Missing,
}

/// Tải và cache ảnh đại diện theo email. Một `Avatars` cho cả app, dùng chung cho mọi cửa sổ repo.
pub struct Avatars {
    cache_dir: PathBuf,
    client: OnceLock<reqwest::Client>,
}

impl Avatars {
    pub fn new(data_dir: &Path) -> Arc<Self> {
        let cache_dir = data_dir.join("avatars");
        let _ = std::fs::create_dir_all(&cache_dir);
        Arc::new(Self { cache_dir, client: OnceLock::new() })
    }

    /// Cache đĩa cho test: dùng thư mục riêng, không tạo HTTP client.
    #[cfg(test)]
    pub fn with_cache_dir(cache_dir: PathBuf) -> Arc<Self> {
        let _ = std::fs::create_dir_all(&cache_dir);
        Arc::new(Self { cache_dir, client: OnceLock::new() })
    }

    /// Data URL (`data:image/png;base64,…`) của ảnh, hoặc `None` khi không có ảnh / không tải được.
    ///
    /// Lỗi mạng không được ghi vào cache: hết mạng thì lần sau vẫn thử lại. Webview chỉ cần biết "chưa có" để vẽ
    /// chữ viết tắt, nên lỗi trả về `None` chứ không phải `Err` — không có gì để người dùng sửa.
    pub async fn data_url(&self, email: &str, size: u32) -> Option<String> {
        let email = email.trim();
        if !normalize(email).contains('@') {
            return None;
        }
        let key = hash(email);
        match self.cached(&key) {
            Some(Cache::Image(data)) => Some(data_url(&data)?),
            Some(Cache::Missing) => None,
            None => {
                let found = self.fetch(email, size).await;
                if let Some(data) = &found {
                    self.store_image(&key, data);
                } else {
                    self.store_missing(&key);
                }
                found.and_then(|data| data_url(&data))
            }
        }
    }

    async fn fetch(&self, email: &str, size: u32) -> Option<Vec<u8>> {
        let client = self.client.get_or_init(|| {
            reqwest::Client::builder()
                .user_agent(USER_AGENT)
                .timeout(REQUEST_TIMEOUT)
                .build()
                .expect("HTTP client cho avatar")
        });
        for url in sources(email, size) {
            let Ok(response) = client.get(&url).send().await else { continue };
            if !response.status().is_success() {
                continue;
            }
            let Ok(data) = response.bytes().await else { continue };
            if data.len() > 4 * 1024 * 1024 {
                continue;
            }
            if sniff_mime(&data).is_some() {
                return Some(data.to_vec());
            }
        }
        None
    }

    fn cached(&self, key: &str) -> Option<Cache> {
        let image = self.cache_dir.join(format!("{key}.img"));
        if fresh(&image, IMAGE_LIFETIME)
            && let Ok(data) = std::fs::read(&image)
            && sniff_mime(&data).is_some()
        {
            return Some(Cache::Image(data));
        }
        if fresh(&self.cache_dir.join(format!("{key}.none")), MISSING_LIFETIME) {
            return Some(Cache::Missing);
        }
        None
    }

    fn store_image(&self, key: &str, data: &[u8]) {
        let _ = std::fs::write(self.cache_dir.join(format!("{key}.img")), data);
        let _ = std::fs::remove_file(self.cache_dir.join(format!("{key}.none")));
    }

    fn store_missing(&self, key: &str) {
        let _ = std::fs::write(self.cache_dir.join(format!("{key}.none")), []);
    }
}

fn data_url(data: &[u8]) -> Option<String> {
    let mime = sniff_mime(data)?;
    Some(format!("data:{mime};base64,{}", BASE64.encode(data)))
}

fn fresh(path: &Path, lifetime: Duration) -> bool {
    let Ok(modified) = std::fs::metadata(path).and_then(|meta| meta.modified()) else { return false };
    SystemTime::now().duration_since(modified).is_ok_and(|age| age < lifetime)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_matches_sha256_of_normalized_email() {
        // SHA-256("a@b.c") — cùng công thức với `AvatarSource.hash` của app Swift.
        assert_eq!(hash(" A@B.C "), hash("a@b.c"));
        assert_eq!(hash("a@b.c"), "d648b243a3e817eaa3309e00e183483f2867baadf522099f0c2121770536b25a");
    }

    #[test]
    fn noreply_emails_split_into_id_and_login() {
        assert_eq!(github_noreply("7+son@users.noreply.github.com"), Some((Some(7), "son".to_string())));
        assert_eq!(github_noreply("son@users.noreply.github.com"), Some((None, "son".to_string())));
        assert_eq!(github_noreply("+son@users.noreply.github.com"), None);
        assert_eq!(github_noreply("son@users.noreply.github.com.evil.example"), None);
        assert_eq!(github_noreply("son@example.com"), None);
    }

    #[test]
    fn sources_prefer_github_then_gravatar() {
        let urls = sources("7+son@users.noreply.github.com", 80);
        assert_eq!(urls, vec![
            "https://avatars.githubusercontent.com/u/7?s=80&v=4".to_string(),
            format!("https://gravatar.com/avatar/{}?s=80&d=404", hash("7+son@users.noreply.github.com")),
        ]);
        assert_eq!(sources("son@example.com", 40), vec![format!("https://gravatar.com/avatar/{}?s=40&d=404", hash("son@example.com"))]);
        assert!(sources("không phải email", 80).is_empty(), "email không hợp lệ thì không hỏi mạng");
    }

    #[test]
    fn only_raster_images_are_accepted() {
        assert_eq!(sniff_mime(b"\x89PNG\r\n\x1a\n...."), Some("image/png"));
        assert_eq!(sniff_mime(b"\xff\xd8\xff\xe0...."), Some("image/jpeg"));
        assert_eq!(sniff_mime(b"GIF89a...."), Some("image/gif"));
        assert_eq!(sniff_mime(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(sniff_mime(b"<svg xmlns='http://www.w3.org/2000/svg'></svg>"), None);
        assert_eq!(sniff_mime(b"<!doctype html>"), None);
        assert_eq!(sniff_mime(b""), None);
    }

    #[test]
    fn cache_round_trips_and_marks_missing() {
        let dir = std::env::temp_dir().join(format!("thaigit-avatar-test-{}", uuid::Uuid::new_v4()));
        let avatars = Avatars::with_cache_dir(dir.clone());
        let png = b"\x89PNG\r\n\x1a\nabc";
        avatars.store_image("k", png);
        assert!(matches!(avatars.cached("k"), Some(Cache::Image(_))));
        // Hết hạn thì coi như chưa có để tải lại.
        let image = dir.join("k.img");
        let file = std::fs::OpenOptions::new().write(true).open(&image).unwrap();
        file.set_modified(SystemTime::now() - IMAGE_LIFETIME - Duration::from_secs(1)).unwrap();
        assert!(avatars.cached("k").is_none());
        avatars.store_missing("m");
        assert!(matches!(avatars.cached("m"), Some(Cache::Missing)));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[tokio::test]
    async fn an_email_without_an_at_sign_never_hits_the_network() {
        let dir = std::env::temp_dir().join(format!("thaigit-avatar-test-{}", uuid::Uuid::new_v4()));
        let avatars = Avatars::with_cache_dir(dir.clone());
        assert_eq!(avatars.data_url("không phải email", 80).await, None);
        assert!(!dir.join(format!("{}.none", hash("không phải email"))).exists(), "email không hợp lệ không ghi cache");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}