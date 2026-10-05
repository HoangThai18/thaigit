//! Ảnh đại diện thật của người commit (như GitKraken), dùng cho node graph.
//!
//! Webview không tự gọi mạng được (CSP chỉ mở `ipc:`), nên Rust tải ảnh rồi trả về **data URL** — `img-src` có
//! `data:` nên canvas vẽ được. Thứ tự nguồn giống app macOS (`AvatarFetcher` của NhanhCore): email ẩn GitHub →
//! Gravatar; không nguồn nào có ảnh thì ghi một dấu "không có" để khỏi hỏi lại trong phiên.
//!
//! Chỉ nhận ảnh PNG/JPEG/GIF/WebP (đoán từ byte đầu, không tin `Content-Type`): data URL của SVG có thể mang
//! script, không để lọt vào webview dù CSP đã khoá.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

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
/// Trần kích thước ảnh (chấm trên graph nhỏ hơn nhiều; chặn máy chủ trả nhầm thứ quá lớn).
const MAX_IMAGE_BYTES: usize = 4 * 1024 * 1024;

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

/// Repo trên github.com tách từ URL remote (`https://`, `ssh://`, `git@github.com:…`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubRepo {
    pub owner: String,
    pub name: String,
}

impl GitHubRepo {
    /// `nil` khi remote không phải github.com (kể cả host trông giống: chỉ đúng ba host của GitHub).
    pub fn parse(remote_url: &str) -> Option<Self> {
        let mut text: String = remote_url.trim().to_string();
        if let Some(scheme) = text.find("://") {
            text = text[scheme + 3..].to_string();
        } else if let Some(colon) = text.find(':')
            && !text[..colon].contains('/')
        {
            // Dạng scp: git@github.com:owner/repo.git
            text = format!("{}/{}", &text[..colon], &text[colon + 1..]);
        } else {
            return None;
        }
        let text = text.as_str();
        let mut parts = text.split('/').filter(|part| !part.is_empty());
        let mut host = parts.next()?;
        if let Some(at) = host.rfind('@') {
            host = &host[at + 1..];
        }
        if let Some(colon) = host.find(':') {
            host = &host[..colon];
        }
        if !matches!(host.to_ascii_lowercase().as_str(), "github.com" | "www.github.com" | "ssh.github.com") {
            return None;
        }
        let owner = parts.next()?.to_string();
        let mut name = parts.next()?.to_string();
        if let Some(stripped) = name.strip_suffix(".git") {
            name = stripped.to_string();
        }
        (!owner.is_empty() && !name.is_empty()).then_some(Self { owner, name })
    }
}

/// API commit gần nhất của tác giả trong repo: tài khoản GitHub gắn với email đó kèm `avatar_url`.
pub fn github_commits_url(repo: &GitHubRepo, email: &str) -> String {
    let normalized = normalize(email);
    let author = percent_encoding::utf8_percent_encode(&normalized, percent_encoding::NON_ALPHANUMERIC);
    format!("https://api.github.com/repos/{}/{}/commits?author={author}&per_page=1", repo.owner, repo.name)
}

/// `avatar_url` của `[0].author` trong kết quả API commit (`author` là null khi email không gắn với tài khoản nào).
pub fn parse_commit_avatar(json: &serde_json::Value) -> Option<String> {
    let raw = json.get(0)?.get("author")?.get("avatar_url")?.as_str()?;
    // Bỏ `?s=` cũ rồi ép cạnh theo `size` để không tải ảnh 460px vẽ vào chấm 17px.
    let base = raw.split('?').next().unwrap_or(raw);
    Some(format!("{base}?s={AVATAR_SIZE}&v=4"))
}

/// Repo GitHub do webview đưa (từ URL remote mà giao diện đã đọc). `None` khi thiếu hoặc ký tự không an toàn —
/// webview không đưa URL nào vào đây, Rust tự dựng `https://api.github.com/...`.
pub fn github_repo(owner: Option<&str>, repo: Option<&str>) -> Option<GitHubRepo> {
    let (owner, repo) = crate::forge::check_repo_path(owner?, repo?).ok()?;
    Some(GitHubRepo { owner, name: repo })
}

/// Nguồn ảnh theo thứ tự ưu tiên, như `AvatarFetcher` của app Swift: email ẩn GitHub → API GitHub của repo (nếu
/// repo nằm trên GitHub) → Gravatar. Không nguồn nào có ảnh thì nhớ "không có" vài ngày cho khỏi hỏi lại.
enum Source {
    Image(String),
    GitHubApi(GitHubRepo, String),
}

fn sources(email: &str, repo: Option<&GitHubRepo>) -> Vec<Source> {
    let mut result = Vec::new();
    if let Some((id, login)) = github_noreply(email)
        && let Some(url) = github_avatar_url(id, &login, AVATAR_SIZE)
    {
        result.push(Source::Image(url));
    }
    if let Some(repo) = repo {
        result.push(Source::GitHubApi(repo.clone(), email.to_string()));
    }
    if let Some(url) = gravatar_url(email, AVATAR_SIZE) {
        result.push(Source::Image(url));
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
    /// API GitHub hết lượt (60 lượt/giờ khi không đăng nhập): bỏ qua tới giờ reset.
    github_blocked_until: Mutex<Option<Instant>>,
}

impl Avatars {
    pub fn new(data_dir: &Path) -> Arc<Self> {
        let cache_dir = data_dir.join("avatars");
        let _ = std::fs::create_dir_all(&cache_dir);
        Arc::new(Self { cache_dir, client: OnceLock::new(), github_blocked_until: Mutex::new(None) })
    }

    /// Cache đĩa cho test: dùng thư mục riêng, không tạo HTTP client.
    #[cfg(test)]
    pub fn with_cache_dir(cache_dir: PathBuf) -> Arc<Self> {
        let _ = std::fs::create_dir_all(&cache_dir);
        Arc::new(Self { cache_dir, client: OnceLock::new(), github_blocked_until: Mutex::new(None) })
    }

    /// Data URL (`data:image/png;base64,…`) của ảnh, hoặc `None` khi không có ảnh / không tải được.
    ///
    /// Lỗi mạng không được ghi vào cache: hết mạng thì lần sau vẫn thử lại. Webview chỉ cần biết "chưa có" để vẽ
    /// chữ viết tắt, nên lỗi trả về `None` chứ không phải `Err` — không có gì để người dùng sửa.
    ///
    /// `repo` là repo trên GitHub của repo đang mở: nhờ vậy tìm được ảnh của người commit bằng email thật (không
    /// phải email ẩn `@users.noreply`) — mà phần lớn người dùng GitHub đều commit bằng email Gmail.
    pub async fn data_url(&self, email: &str, repo: Option<&GitHubRepo>, token: Option<&str>) -> Option<String> {
        let email = email.trim();
        if !normalize(email).contains('@') {
            return None;
        }
        let key = hash(email);
        match self.cached(&key, repo.is_some()) {
            Some(Cache::Image(data)) => Some(data_url(&data)?),
            Some(Cache::Missing) => None,
            None => {
                let found = self.fetch(email, repo, token).await;
                if let Some(data) = &found {
                    self.store_image(&key, data);
                } else {
                    self.store_missing(&key, repo.is_some());
                }
                found.and_then(|data| data_url(&data))
            }
        }
    }

    fn http(&self) -> &reqwest::Client {
        self.client.get_or_init(|| {
            reqwest::Client::builder()
                .user_agent(USER_AGENT)
                .timeout(REQUEST_TIMEOUT)
                .build()
                .expect("HTTP client cho avatar")
        })
    }

    async fn fetch(&self, email: &str, repo: Option<&GitHubRepo>, token: Option<&str>) -> Option<Vec<u8>> {
        for source in sources(email, repo) {
            match source {
                Source::Image(url) => {
                    if let Some(data) = self.download(&url).await {
                        return Some(data);
                    }
                }
                Source::GitHubApi(repo, email) => {
                    if let Some(data) = self.github_avatar(&repo, &email, token).await {
                        return Some(data);
                    }
                }
            }
        }
        None
    }

    async fn download(&self, url: &str) -> Option<Vec<u8>> {
        let response = self.http().get(url).send().await.ok()?;
        if !response.status().is_success() {
            return None;
        }
        let data = response.bytes().await.ok()?;
        if data.len() > MAX_IMAGE_BYTES {
            return None;
        }
        sniff_mime(&data).map(|_| data.to_vec())
    }

    /// 401: token hết hạn / bị thu hồi — lỗi tạm (đăng nhập lại là hỏi được). 404/409/422: repo riêng tư chưa
    /// đăng nhập, repo rỗng, email lạ — GitHub không có ảnh. 403/429 hoặc `X-RateLimit-Remaining: 0`: hết lượt,
    /// chặn tới giờ reset.
    async fn github_avatar(&self, repo: &GitHubRepo, email: &str, token: Option<&str>) -> Option<Vec<u8>> {
        {
            let blocked = self.github_blocked_until.lock().unwrap_or_else(|error| error.into_inner());
            if blocked.is_some_and(|until| Instant::now() < until) {
                return None;
            }
        }
        let mut request = self.http().get(github_commits_url(repo, email));
        request = request
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28");
        if let Some(token) = token.filter(|value| !value.is_empty()) {
            request = request.header("Authorization", format!("Bearer {token}"));
        }
        let response = request.send().await.ok()?;
        let status = response.status().as_u16();
        if status == 403 || status == 429 || response.headers().get("x-ratelimit-remaining").is_some_and(|v| v == "0") {
            let reset = response
                .headers()
                .get("x-ratelimit-reset")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<i64>().ok())
                .and_then(|seconds| SystemTime::UNIX_EPOCH.checked_add(Duration::from_secs(seconds as u64)))
                .map(|at| at.duration_since(SystemTime::now()).unwrap_or_default())
                .map(|left| Instant::now() + left);
            *self.github_blocked_until.lock().unwrap_or_else(|error| error.into_inner()) =
                Some(reset.unwrap_or_else(|| Instant::now() + Duration::from_secs(3600)));
            if status != 200 {
                return None;
            }
        }
        if status != 200 {
            return None;
        }
        let json: serde_json::Value = response.json().await.ok()?;
        let url = parse_commit_avatar(&json)?;
        self.download(&url).await
    }

    fn cached(&self, key: &str, asked_github: bool) -> Option<Cache> {
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
        // Chưa hỏi API GitHub (repo không nằm trên GitHub): nhớ riêng để sau này có repo GitHub vẫn hỏi được.
        if !asked_github && fresh(&self.cache_dir.join(format!("{key}.nogithub.none")), MISSING_LIFETIME) {
            return Some(Cache::Missing);
        }
        None
    }

    fn store_image(&self, key: &str, data: &[u8]) {
        let _ = std::fs::write(self.cache_dir.join(format!("{key}.img")), data);
        for suffix in [".none", ".nogithub.none"] {
            let _ = std::fs::remove_file(self.cache_dir.join(format!("{key}{suffix}")));
        }
    }

    fn store_missing(&self, key: &str, asked_github: bool) {
        let _ = std::fs::write(self.cache_dir.join(format!("{key}{}", if asked_github { ".none" } else { ".nogithub.none" })), []);
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

    fn image_url(source: &Source) -> Option<&str> {
        match source {
            Source::Image(url) => Some(url),
            Source::GitHubApi(_, _) => None,
        }
    }

    fn image_urls(email: &str, repo: Option<&GitHubRepo>) -> Vec<String> {
        sources(email, repo).iter().filter_map(|source| image_url(source).map(str::to_string)).collect()
    }

    #[test]
    fn sources_prefer_github_then_api_then_gravatar() {
        let repo = GitHubRepo::parse("https://github.com/acme/app.git").unwrap();
        // Email ẩn GitHub không cần API: ảnh lấy thẳng từ avatars.githubusercontent.com.
        assert_eq!(image_urls("7+son@users.noreply.github.com", Some(&repo)), vec![
            "https://avatars.githubusercontent.com/u/7?s=80&v=4".to_string(),
            format!("https://gravatar.com/avatar/{}?s=80&d=404", hash("7+son@users.noreply.github.com")),
        ]);
        // Email thật (không có Gravatar) chỉ còn API commit là cứu cánh — đúng như app Swift.
        assert_eq!(image_urls("son@example.com", Some(&repo)), vec![format!(
            "https://gravatar.com/avatar/{}?s=80&d=404",
            hash("son@example.com")
        )]);
        assert!(sources("son@example.com", Some(&repo)).iter().any(|source| matches!(source, Source::GitHubApi(_, _))));
        assert!(!sources("son@example.com", None).iter().any(|source| matches!(source, Source::GitHubApi(_, _))));
        assert!(image_urls("không phải email", Some(&repo)).is_empty(), "email không hợp lệ thì không hỏi mạng");
    }

    #[test]
    fn github_remote_urls_are_recognised() {
        let expected = GitHubRepo { owner: "acme".to_string(), name: "app".to_string() };
        for url in [
            "https://github.com/acme/app.git",
            "https://github.com/acme/app",
            "https://www.github.com/acme/app/",
            "ssh://git@github.com/acme/app.git",
            "git@github.com:acme/app.git",
            "  https://github.com/acme/app  ",
        ] {
            assert_eq!(GitHubRepo::parse(url), Some(expected.clone()), "{url}");
        }
        for url in [
            "https://github.com/acme",
            "https://github.com.evil.example/acme/app.git",
            "https://gitlab.com/acme/app.git",
            "git@gitlab.com:acme/app.git",
            "/local/path/repo",
            "",
        ] {
            assert_eq!(GitHubRepo::parse(url), None, "{url}");
        }
    }

    #[test]
    fn webview_cannot_point_the_lookup_at_another_host() {
        let repo = github_repo(Some("acme"), Some("app")).unwrap();
        assert_eq!(repo, GitHubRepo { owner: "acme".to_string(), name: "app".to_string() });
        // owner/repo sai ký tự hoặc thiếu một nửa thì bỏ qua nguồn API thay vì báo lỗi.
        assert!(github_repo(Some("acme/../evil"), Some("app")).is_none());
        assert!(github_repo(Some("acme"), Some("app?x=1")).is_none());
        assert!(github_repo(Some("acme"), None).is_none());
        assert!(github_repo(None, Some("app")).is_none());
    }

    #[test]
    fn commits_url_encodes_the_email_and_never_takes_a_url_from_the_webview() {
        let repo = GitHubRepo { owner: "acme".to_string(), name: "app".to_string() };
        assert_eq!(
            github_commits_url(&repo, "a+b@x.vn"),
            "https://api.github.com/repos/acme/app/commits?author=a%2Bb%40x%2Evn&per_page=1"
        );
    }

    #[test]
    fn commit_avatar_url_is_resized_and_null_author_is_no_avatar() {
        let json = serde_json::json!([{ "author": { "avatar_url": "https://avatars.githubusercontent.com/u/9321364?v=4&s=460" } }]);
        assert_eq!(
            parse_commit_avatar(&json).as_deref(),
            Some(format!("https://avatars.githubusercontent.com/u/9321364?s={AVATAR_SIZE}&v=4").as_str())
        );
        // `author` null = email không gắn với tài khoản GitHub nào → không có ảnh, đừng hỏi lại.
        assert_eq!(parse_commit_avatar(&serde_json::json!([{ "author": null }])), None);
        assert_eq!(parse_commit_avatar(&serde_json::json!([])), None);
        assert_eq!(parse_commit_avatar(&serde_json::json!([{}])), None);
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
        assert!(matches!(avatars.cached("k", true), Some(Cache::Image(_))));
        // Hết hạn thì coi như chưa có để tải lại.
        let image = dir.join("k.img");
        let file = std::fs::OpenOptions::new().write(true).open(&image).unwrap();
        file.set_modified(SystemTime::now() - IMAGE_LIFETIME - Duration::from_secs(1)).unwrap();
        assert!(avatars.cached("k", true).is_none());
        // "Không có ảnh" nhớ riêng cho repo không ở GitHub: sau này mở repo GitHub vẫn phải hỏi được.
        avatars.store_missing("m", false);
        assert!(matches!(avatars.cached("m", false), Some(Cache::Missing)));
        assert!(avatars.cached("m", true).is_none(), "đã hỏi API GitHub thì phải hỏi lại được");
        avatars.store_missing("n", true);
        assert!(matches!(avatars.cached("n", true), Some(Cache::Missing)));
        assert!(matches!(avatars.cached("n", false), Some(Cache::Missing)));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[tokio::test]
    async fn an_email_without_an_at_sign_never_hits_the_network() {
        let dir = std::env::temp_dir().join(format!("thaigit-avatar-test-{}", uuid::Uuid::new_v4()));
        let avatars = Avatars::with_cache_dir(dir.clone());
        assert_eq!(avatars.data_url("không phải email", None, None).await, None);
        assert!(!dir.join(format!("{}.none", hash("không phải email"))).exists(), "email không hợp lệ không ghi cache");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}