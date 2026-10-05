//! Gọi API của máy chủ git: đăng nhập (OAuth device flow hoặc token người dùng dán), đọc danh sách repo, tổ chức và
//! Pull Request / Merge Request. Mọi request đi từ Rust (webview không có scope HTTP), token chỉ nằm trong biến cục bộ
//! của lệnh và không bao giờ vào log.

use serde::{Deserialize, Serialize};

use crate::accounts::{Provider, provider_for, valid_host};
use crate::errors::{AppError, Result};

const USER_AGENT: &str = concat!("Thaigit/", env!("CARGO_PKG_VERSION"));
const MAX_ITEMS: usize = 200;
const REQUEST_TIMEOUT_S: u64 = 30;

/// Số trang tối đa khi lấy danh sách (mỗi trang 100 / 20 mục tuỳ API).
const MAX_PAGES: u32 = 5;

fn http() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_S))
        // Token đi trong header `Authorization`; không để reqwest gửi nó theo URL (redirect có thể đổi host).
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| AppError::Internal(format!("Không tạo được HTTP client: {error}")))
}

/// Một request: URL đã dựng từ host đã kiểm, token ở header. Chỉ chấp nhận JSON.
async fn request(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: &str,
    token: &str,
    body: Option<&serde_json::Value>,
) -> Result<(u16, serde_json::Value)> {
    let mut builder = client.request(method, url).header("Accept", "application/json");
    // Bước xin mã / hỏi token của device flow chưa có token: không gửi header rỗng.
    if !token.is_empty() {
        builder = builder.header("Authorization", format!("Bearer {token}"));
    }
    if let Some(body) = body {
        builder = builder.json(body);
    }
    let response = builder.send().await.map_err(|error| {
        if error.is_timeout() {
            AppError::Io(format!("Máy chủ không phản hồi trong {REQUEST_TIMEOUT_S} giây"))
        } else if error.is_connect() {
            AppError::Io(format!("Không kết nối được tới máy chủ: {}", host_of(url)))
        } else {
            AppError::Io(format!("Lỗi mạng: {}", host_of(url)))
        }
    })?;
    let status = response.status().as_u16();
    let text = response.text().await.map_err(|error| AppError::Io(format!("Lỗi đọc phản hồi: {error}")))?;
    let value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    Ok((status, value))
}

fn host_of(url: &str) -> String {
    url::Url::parse(url).ok().and_then(|parsed| parsed.host_str().map(|host| host.to_string())).unwrap_or_else(|| "máy chủ".into())
}

/// Lỗi theo mã của máy chủ → lỗi chuẩn hoá (UI hiện câu thân thiện, kỹ thuật ở Nhật ký lệnh).
fn check_status(_provider: Provider, host: &str, status: u16, body: &serde_json::Value) -> Result<()> {
    match status {
        200..=299 => Ok(()),
        401 => Err(AppError::Auth(format!(
            "Token của {host} không hợp lệ hoặc đã hết hạn (401) — đăng nhập lại tài khoản đó"
        ))),
        403 => {
            let message = body["message"].as_str().unwrap_or_default();
            let scope = if message.to_lowercase().contains("scope") { " — token thiếu quyền" } else { "" };
            Err(AppError::Auth(format!("Tài khoản không có quyền trên {host} (403){scope}")))
        }
        404 => Err(AppError::NotFound(format!("Không tìm thấy trên {host} (404) — kiểm tra tên repo hoặc tài khoản"))),
        // Máy chủ hiểu yêu cầu nhưng không nhận (nhánh nguồn chưa push, đã có PR cho nhánh này…).
        409 | 422 => {
            let message = body["message"].as_str().unwrap_or_default();
            Err(AppError::Conflict(format!("Máy chủ {host} không nhận yêu cầu ({status}): {message}")))
        }
        429 => Err(AppError::Io(format!("Máy chủ {host} giới hạn số yêu cầu — thử lại sau ít phút"))),
        500..=599 => Err(AppError::Io(format!("Máy chủ {host} đang lỗi ({status}) — thử lại sau"))),
        _ => Err(AppError::Io(format!("Máy chủ {host} trả lỗi {status}"))),
    }
}

/// Danh tính tài khoản lấy từ API (không có token).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    pub login: String,
    pub display_name: String,
    /// Id của máy chủ (GitHub dùng cho email ẩn).
    pub id: String,
}

/// Một repo mà tài khoản truy cập được.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeRepository {
    pub host: String,
    pub path: String,
    pub name: String,
    pub default_branch: String,
    pub is_private: bool,
    pub web_url: String,
    /// URL clone HTTPS, không kèm token (token đi qua credential helper của app).
    pub clone_url: String,
}

/// Pull Request (GitHub / Bitbucket) hoặc Merge Request (GitLab) — cùng một kiểu để UI hiển thị giống nhau.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeMergeRequest {
    pub host: String,
    /// Số PR/MR (GitHub) hoặc `iid` (GitLab / Bitbucket).
    pub number: String,
    pub title: String,
    pub body: String,
    pub author: String,
    pub source_branch: String,
    pub target_branch: String,
    pub state: String,
    pub draft: bool,
    pub web_url: String,
    pub head_host: String,
    pub head_owner: String,
    pub updated_at: String,
    /// Số commit / thay đổi nếu API có (GitHub có `commits`).
    pub commits: Option<u32>,
    /// Người được gán xử lý (Bitbucket không có khái niệm này).
    pub assignees: Vec<ForgePerson>,
    /// Người được nhờ review.
    pub reviewers: Vec<ForgePerson>,
}

/// Người dùng trên máy chủ có thể được gán vào PR / MR (hoặc đã được gán).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgePerson {
    pub username: String,
    /// Tên hiển thị (có thể trống: GitHub trả danh sách người chỉ có `login`).
    #[serde(default)]
    pub name: String,
    /// GitLab gán người theo số id; GitHub gán theo `username` (không có id).
    #[serde(default)]
    pub id: Option<i64>,
}

/// Danh sách nào của PR / MR đang được sửa.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PeopleRole {
    Reviewers,
    Assignees,
}

/// Mã của màn hình đăng nhập bằng mã (OAuth device flow).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u32,
    pub interval: u32,
    /// Bí mật tạm của RFC 8628: webview giữ để hỏi token, hết hạn cùng mã người dùng nhập, không phải token dài hạn.
    pub device_code: String,
}

/// Phạm vi cần xin khi đăng nhập bằng device flow.
pub fn scopes(provider: Provider) -> &'static str {
    match provider {
        Provider::Github => "repo workflow read:org write:public_key",
        Provider::Gitlab => "api read_api read_user read_repository",
        // Bitbucket không có device flow.
        Provider::Bitbucket => "",
    }
}

// MARK: - Khoá SSH

/// Kết quả gửi khoá SSH công khai lên tài khoản.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SshKeyUpload {
    Added,
    AlreadyExists,
    /// Token thiếu quyền thêm khoá (GitHub: `write:public_key`, GitLab: `api`) hoặc máy chủ không hỗ trợ: tự dán ở trang web.
    MissingScope,
}

/// Thêm khoá SSH công khai vào tài khoản (`POST /user/keys` của GitHub và GitLab).
pub async fn add_ssh_key(host: &str, provider: Provider, token: &str, title: &str, public_key: &str) -> Result<SshKeyUpload> {
    if provider == Provider::Bitbucket {
        return Ok(SshKeyUpload::MissingScope);
    }
    let client = http()?;
    let url = format!("{}/user/keys", provider.api_base(host));
    let body = serde_json::json!({ "title": title, "key": public_key });
    let (status, value) = request(&client, reqwest::Method::POST, &url, token, Some(&body)).await?;
    let text = value.to_string().to_lowercase();
    match status {
        200..=299 => Ok(SshKeyUpload::Added),
        400 | 422 if text.contains("already") || text.contains("taken") => Ok(SshKeyUpload::AlreadyExists),
        403 | 404 => Ok(SshKeyUpload::MissingScope),
        _ => {
            check_status(provider, host, status, &value)?;
            Err(AppError::Io(format!("Máy chủ {host} không nhận khoá SSH ({status})")))
        }
    }
}

/// Trang thêm khoá SSH bằng tay trên máy chủ.
pub fn ssh_keys_page(host: &str, provider: Provider) -> String {
    match provider {
        Provider::Github => format!("https://{host}/settings/ssh/new"),
        Provider::Gitlab => format!("https://{host}/-/user_settings/ssh_keys"),
        Provider::Bitbucket => "https://bitbucket.org/account/settings/ssh-keys/".to_string(),
    }
}

// MARK: - Device flow

/// Địa chỉ của device flow trên host: (xin mã, hỏi token). GitHub Enterprise dùng chính host đó.
fn device_flow_urls(host: &str, provider: Provider) -> (String, String) {
    match provider {
        Provider::Github => (format!("https://{host}/login/device/code"), format!("https://{host}/login/oauth/access_token")),
        // GitLab: Application ID của app đăng ký (public client, không cần secret).
        _ => (format!("https://{host}/oauth/authorize_device"), format!("https://{host}/oauth/token")),
    }
}

/// Trang người dùng nhập mã: chỉ nhận trang https trên đúng host đó (phản hồi bị sửa cũng không mở được trang lạ).
fn same_host_page(uri: &str, host: &str) -> String {
    let fallback = format!("https://{host}/login/device");
    match url::Url::parse(uri) {
        Ok(parsed) if parsed.scheme() == "https" && parsed.host_str().is_some_and(|h| h.eq_ignore_ascii_case(host)) => uri.to_string(),
        _ => fallback,
    }
}

/// Bước 1: xin mã để người dùng nhập trên trang của máy chủ.
pub async fn request_device_code(host: &str, provider: Provider, client_id: &str) -> Result<DeviceCode> {
    let client = http()?;
    let (url, _) = device_flow_urls(host, provider);
    let body = serde_json::json!({ "client_id": client_id, "scope": scopes(provider) });
    let (status, value) = request(&client, reqwest::Method::POST, &url, "", Some(&body)).await?;
    if status == 404 || status == 400 {
        return Err(AppError::Auth(format!("Máy chủ {host} không nhận ra Client ID của OAuth App")));
    }
    check_status(provider, host, status, &value)?;
    let user_code = value["device_code_user_code"].as_str().or_else(|| value["user_code"].as_str()).unwrap_or_default().to_string();
    let device_code = value["device_code"].as_str().unwrap_or_default().to_string();
    let verification_uri = value["verification_uri"]
        .as_str()
        .or_else(|| value["verification_uri_complete"].as_str())
        .unwrap_or_default()
        .to_string();
    if user_code.is_empty() || device_code.is_empty() || verification_uri.is_empty() {
        return Err(AppError::Io(format!("Máy chủ {host} không trả về mã đăng nhập đúng dạng")));
    }
    let verification_uri = same_host_page(&verification_uri, host);
    Ok(DeviceCode {
        user_code,
        verification_uri,
        expires_in: value["expires_in"].as_u64().unwrap_or(900) as u32,
        interval: value["interval"].as_u64().unwrap_or(5).max(1) as u32,
        device_code,
    })
}

/// Token OAuth máy chủ cấp. GitLab: token sống ~2 giờ, kèm refresh token để làm mới (GitHub OAuth App: không hết hạn).
#[derive(PartialEq, Eq)]
pub struct TokenGrant {
    pub access: String,
    pub refresh: Option<String>,
    pub expires_in: Option<u64>,
}

impl std::fmt::Debug for TokenGrant {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TokenGrant").field("refresh", &self.refresh.is_some()).field("expires_in", &self.expires_in).finish()
    }
}

impl TokenGrant {
    fn from_json(value: &serde_json::Value) -> Option<TokenGrant> {
        let access = value["access_token"].as_str().filter(|token| !token.is_empty())?.to_string();
        Some(TokenGrant {
            access,
            refresh: value["refresh_token"].as_str().filter(|token| !token.is_empty()).map(str::to_string),
            expires_in: value["expires_in"].as_u64(),
        })
    }
}

/// Kết quả một lần hỏi token của device flow.
#[derive(Debug, PartialEq, Eq)]
pub enum PollOutcome {
    /// Người dùng chưa xác nhận: hỏi lại sau `interval`.
    Pending,
    /// Máy chủ bảo hỏi chậm lại (RFC 8628): cộng thêm 5 giây vào `interval`.
    SlowDown,
    Token(TokenGrant),
}

/// Làm mới token OAuth bằng refresh token (public client: chỉ cần Client ID). Refresh token cũ hết hiệu lực sau lần này.
pub async fn refresh_token(host: &str, provider: Provider, client_id: &str, refresh: &str) -> Result<TokenGrant> {
    let client = http()?;
    let (_, url) = device_flow_urls(host, provider);
    let body = serde_json::json!({ "client_id": client_id, "refresh_token": refresh, "grant_type": "refresh_token" });
    let (status, value) = request(&client, reqwest::Method::POST, &url, "", Some(&body)).await?;
    if let Some(grant) = TokenGrant::from_json(&value).filter(|_| (200..300).contains(&status)) {
        return Ok(grant);
    }
    Err(AppError::Auth(format!("Phiên đăng nhập {host} đã hết hạn — đăng nhập lại tài khoản đó")))
}

/// Bước 2: hỏi token một lần (UI hỏi lại theo `interval` cho tới khi người dùng xác nhận).
pub async fn poll_for_token(host: &str, provider: Provider, client_id: &str, device_code: &str) -> Result<PollOutcome> {
    let client = http()?;
    let (_, url) = device_flow_urls(host, provider);
    let body = serde_json::json!({
        "client_id": client_id,
        "device_code": device_code,
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
    });
    let (status, value) = request(&client, reqwest::Method::POST, &url, "", Some(&body)).await?;
    if let Some(grant) = TokenGrant::from_json(&value) {
        return Ok(PollOutcome::Token(grant));
    }
    let error = value["error"].as_str().unwrap_or_default();
    match error {
        "authorization_pending" => Ok(PollOutcome::Pending),
        "slow_down" => Ok(PollOutcome::SlowDown),
        "access_denied" => Err(AppError::Auth(format!("Bạn đã từ chối đăng nhập {host}"))),
        "expired_token" => Err(AppError::Auth(format!("Mã đăng nhập {host} đã hết hạn — bấm đăng nhập lại"))),
        _ => {
            check_status(provider, host, status, &value)?;
            // Mã 200 nhưng không có token: máy chủ trả lời lệch — hỏi lại thay vì báo đăng nhập sai.
            Ok(PollOutcome::Pending)
        }
    }
}

// MARK: - Danh tính, tổ chức, repo

/// Đọc danh tính tài khoản từ token (dùng để kiểm tra token trước khi lưu).
pub async fn fetch_identity(host: &str, provider: Provider, token: &str) -> Result<Identity> {
    let client = http()?;
    let base = provider.api_base(host);
    let url = format!("{base}/user");
    let (status, value) = request(&client, reqwest::Method::GET, &url, token, None).await?;
    check_status(provider, host, status, &value)?;
    let identity = match provider {
        Provider::Github => Identity {
            login: value["login"].as_str().unwrap_or_default().to_string(),
            display_name: value["name"].as_str().unwrap_or_default().to_string(),
            id: value["id"].as_i64().unwrap_or_default().to_string(),
        },
        Provider::Gitlab => Identity {
            login: value["username"].as_str().unwrap_or_default().to_string(),
            display_name: value["name"].as_str().unwrap_or_default().to_string(),
            id: value["id"].as_i64().unwrap_or_default().to_string(),
        },
        Provider::Bitbucket => Identity {
            login: value["username"].as_str().unwrap_or_default().to_string(),
            display_name: value["display_name"].as_str().unwrap_or_default().to_string(),
            id: value["uuid"].as_str().unwrap_or_default().to_string(),
        },
    };
    if identity.login.is_empty() {
        return Err(AppError::Io(format!("Máy chủ {host} không trả về tên đăng nhập")));
    }
    Ok(identity)
}

/// Tổ chức / nhóm / workspace mà tài khoản là thành viên — để chọn token theo owner.
pub async fn fetch_organizations(host: &str, provider: Provider, token: &str) -> Result<Vec<String>> {
    let client = http()?;
    let base = provider.api_base(host);
    let mut names: Vec<String> = Vec::new();
    for (page, url) in pages(provider, &base, "orgs", "groups", 100).into_iter().enumerate() {
        let (status, value) = request(&client, reqwest::Method::GET, &url, token, None).await?;
        // GitHub trả 403 khi token thiếu `read:org` — tổ chức chỉ để chọn token, thiếu thì bỏ trống cũng được.
        if status == 403 || status == 401 {
            return Ok(names);
        }
        check_status(provider, host, status, &value)?;
        let Some(items) = value.as_array() else { break };
        for item in items {
            let name = match provider {
                Provider::Github => item["login"].as_str(),
                Provider::Gitlab => item["path"].as_str().or_else(|| item["full_path"].as_str().and_then(|p| p.split('/').next_back())),
                Provider::Bitbucket => item["slug"].as_str().or_else(|| item["name"].as_str()),
            }
            .unwrap_or_default();
            if !name.is_empty() && !names.iter().any(|existing| existing == name) {
                names.push(name.to_string());
            }
        }
        if items.len() < 100 || page as u32 + 1 >= MAX_PAGES || names.len() >= MAX_ITEMS {
            break;
        }
    }
    Ok(names)
}

/// Danh sách repo của tài khoản (dùng cho hộp Clone).
pub async fn list_repositories(host: &str, provider: Provider, token: &str, login: &str) -> Result<Vec<ForgeRepository>> {
    let client = http()?;
    let base = provider.api_base(host);
    let mut repos: Vec<ForgeRepository> = Vec::new();
    for (page, url) in repository_pages(provider, host, &base, login).into_iter().enumerate() {
        let (status, value) = request(&client, reqwest::Method::GET, &url, token, None).await?;
        check_status(provider, host, status, &value)?;
        let items = match provider {
            Provider::Github => value.as_array().cloned().unwrap_or_default(),
            Provider::Gitlab => value.as_array().cloned().unwrap_or_default(),
            Provider::Bitbucket => value["values"].as_array().cloned().unwrap_or_default(),
        };
        for item in &items {
            if let Some(repo) = parse_repository(host, provider, item, login)
                && !repos.iter().any(|existing| existing.path.eq_ignore_ascii_case(&repo.path))
            {
                repos.push(repo);
            }
        }
        let done = match provider {
            Provider::Bitbucket => items.len() < 10 || value["next"].is_null(),
            _ => items.len() < 100,
        };
        if done || page as u32 + 1 >= MAX_PAGES || repos.len() >= MAX_ITEMS {
            break;
        }
    }
    Ok(repos)
}

/// URL từng trang của endpoint danh sách repo. Bitbucket Cloud cần workspace nên không chia trang bằng `page`.
fn repository_pages(provider: Provider, host: &str, base: &str, login: &str) -> Vec<String> {
    match provider {
        Provider::Github => {
            (1..=MAX_PAGES)
                .map(|page| format!("{base}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member&page={page}"))
                .collect()
        }
        Provider::Gitlab => (1..=MAX_PAGES).map(|page| format!("{base}/projects?membership=true&per_page=100&page={page}&order_by=last_activity_at")).collect(),
        // `login` là workspace của tài khoản Bitbucket.
        Provider::Bitbucket => {
            let _ = host;
            vec![format!("{base}/repositories/{}?role=member&sort=-updated_on&pagelen=100", urlencode(login))]
        }
    }
}

/// URL từng trang của endpoint tổ chức.
fn pages(provider: Provider, base: &str, github: &str, gitlab: &str, per_page: u32) -> Vec<String> {
    match provider {
        Provider::Github => (1..=MAX_PAGES).map(|page| format!("{base}/user/{github}?per_page={per_page}&page={page}")).collect(),
        Provider::Gitlab => (1..=MAX_PAGES).map(|page| format!("{base}/{gitlab}?per_page={per_page}&page={page}")).collect(),
        // Workspace của Bitbucket lấy ở chỗ khác (`fetch_identity` tự gọi); không cần trang ở đây.
        Provider::Bitbucket => vec![format!("{base}/workspaces?role=member")],
    }
}

fn parse_repository(host: &str, provider: Provider, item: &serde_json::Value, login: &str) -> Option<ForgeRepository> {
    let web_base = provider.web_base(host);
    let repo = match provider {
        Provider::Github => {
            let path = item["full_name"].as_str()?.to_string();
            ForgeRepository {
                host: host.to_string(),
                path: path.clone(),
                name: item["name"].as_str().unwrap_or_default().to_string(),
                default_branch: item["default_branch"].as_str().filter(|b| !b.is_empty()).unwrap_or("main").to_string(),
                is_private: item["private"].as_bool().unwrap_or(false),
                web_url: format!("{web_base}/{path}"),
                clone_url: format!("{web_base}/{path}.git"),
            }
        }
        Provider::Gitlab => {
            let path = item["path_with_namespace"].as_str().unwrap_or_default().to_string();
            if path.is_empty() {
                return None;
            }
            ForgeRepository {
                host: host.to_string(),
                path: path.clone(),
                name: item["name"].as_str().unwrap_or_default().to_string(),
                default_branch: item["default_branch"].as_str().filter(|b| !b.is_empty()).unwrap_or("main").to_string(),
                is_private: item["visibility"].as_str().map(|v| v != "public").unwrap_or(true),
                web_url: item["web_url"].as_str().unwrap_or(&format!("{web_base}/{path}")).to_string(),
                clone_url: format!("{web_base}/{path}.git"),
            }
        }
        Provider::Bitbucket => {
            let path = item["full_name"].as_str().unwrap_or_default().to_string();
            if path.is_empty() {
                return None;
            }
            ForgeRepository {
                host: host.to_string(),
                path: path.clone(),
                name: item["name"].as_str().unwrap_or_default().to_string(),
                default_branch: item["mainbranch"]["name"].as_str().filter(|b| !b.is_empty()).unwrap_or("main").to_string(),
                is_private: item["is_private"].as_bool().unwrap_or(true),
                web_url: item["links"]["html"]["href"].as_str().unwrap_or(&format!("{web_base}/{path}")).to_string(),
                clone_url: format!("{web_base}/{path}.git"),
            }
        }
    };
    let _ = login;
    Some(repo)
}

fn urlencode(value: &str) -> String {
    percent_encoding::utf8_percent_encode(value, percent_encoding::NON_ALPHANUMERIC).to_string()
}

// MARK: - Pull Request / Merge Request

/// PR đang mở của repo.
pub async fn list_merge_requests(host: &str, provider: Provider, token: &str, owner: &str, repo: &str) -> Result<Vec<ForgeMergeRequest>> {
    let client = http()?;
    let base = provider.api_base(host);
    let mut items: Vec<ForgeMergeRequest> = Vec::new();
    for page in 1..=MAX_PAGES {
        let url = merge_request_list_url(provider, &base, owner, repo, page);
        let (status, value) = request(&client, reqwest::Method::GET, &url, token, None).await?;
        check_status(provider, host, status, &value)?;
        let raw = match provider {
            Provider::Bitbucket => value["values"].as_array().cloned().unwrap_or_default(),
            _ => value.as_array().cloned().unwrap_or_default(),
        };
        if raw.is_empty() {
            break;
        }
        for item in &raw {
            if let Some(parsed) = parse_merge_request(host, provider, owner, repo, item) {
                items.push(parsed);
            }
        }
        if raw.len() < 30 || items.len() >= MAX_ITEMS {
            break;
        }
    }
    Ok(items)
}

fn merge_request_list_url(provider: Provider, base: &str, owner: &str, repo: &str, page: u32) -> String {
    match provider {
        Provider::Github => format!("{base}/repos/{owner}/{repo}/pulls?state=open&per_page=100&page={page}"),
        Provider::Gitlab => format!(
            "{base}/projects/{}/merge_requests?state=opened&per_page=100&page={page}&order_by=updated_at",
            urlencode(&format!("{owner}/{repo}"))
        ),
        Provider::Bitbucket => format!("{base}/repositories/{owner}/{repo}/pullrequests?state=OPEN&pagelen=50&page={page}"),
    }
}

/// Tạo PR / MR từ nhánh hiện tại.
#[allow(clippy::too_many_arguments)]
pub async fn create_merge_request(
    host: &str,
    provider: Provider,
    token: &str,
    owner: &str,
    repo: &str,
    title: &str,
    body: &str,
    source_branch: &str,
    target_branch: &str,
    draft: bool,
) -> Result<ForgeMergeRequest> {
    if title.trim().is_empty() || source_branch.is_empty() || target_branch.is_empty() {
        return Err(AppError::policy("Tiêu đề, nhánh nguồn và nhánh đích đều phải có"));
    }
    let client = http()?;
    let base = provider.api_base(host);
    let (url, payload) = match provider {
        Provider::Github => (
            format!("{base}/repos/{owner}/{repo}/pulls"),
            serde_json::json!({ "title": title, "body": body, "head": source_branch, "base": target_branch, "draft": draft }),
        ),
        Provider::Gitlab => (
            format!("{base}/projects/{}/merge_requests", urlencode(&format!("{owner}/{repo}"))),
            serde_json::json!({
                "source_branch": source_branch,
                "target_branch": target_branch,
                "title": title,
                "description": body,
            }),
        ),
        Provider::Bitbucket => (
            format!("{base}/repositories/{owner}/{repo}/pullrequests"),
            serde_json::json!({
                "title": title,
                "description": body,
                "source": { "branch": { "name": source_branch } },
                "destination": { "branch": { "name": target_branch } },
            }),
        ),
    };
    let (status, value) = request(&client, reqwest::Method::POST, &url, token, Some(&payload)).await?;
    check_status(provider, host, status, &value)?;
    parse_merge_request(host, provider, owner, repo, &value)
        .ok_or_else(|| AppError::Io(format!("Máy chủ {host} không trả về PR vừa tạo")))
}

/// Một PR cụ thể (dùng khi cần số commit / trạng thái chi tiết).
pub async fn fetch_merge_request(
    host: &str,
    provider: Provider,
    token: &str,
    owner: &str,
    repo: &str,
    number: &str,
) -> Result<ForgeMergeRequest> {
    let client = http()?;
    let base = provider.api_base(host);
    let url = match provider {
        Provider::Github => format!("{base}/repos/{owner}/{repo}/pulls/{number}"),
        Provider::Gitlab => {
            format!("{base}/projects/{}/merge_requests/{number}", urlencode(&format!("{owner}/{repo}")))
        }
        Provider::Bitbucket => format!("{base}/repositories/{owner}/{repo}/pullrequests/{number}"),
    };
    let (status, value) = request(&client, reqwest::Method::GET, &url, token, None).await?;
    check_status(provider, host, status, &value)?;
    parse_merge_request(host, provider, owner, repo, &value)
        .ok_or_else(|| AppError::Io(format!("Máy chủ {host} không trả về PR {number}")))
}

fn parse_merge_request(
    host: &str,
    provider: Provider,
    owner: &str,
    repo: &str,
    item: &serde_json::Value,
) -> Option<ForgeMergeRequest> {
    let web_base = provider.web_base(host);
    let merge_request = match provider {
        Provider::Github => ForgeMergeRequest {
            host: host.to_string(),
            number: item["number"].as_i64()?.to_string(),
            title: item["title"].as_str().unwrap_or_default().to_string(),
            body: item["body"].as_str().unwrap_or_default().to_string(),
            author: item["user"]["login"].as_str().unwrap_or_default().to_string(),
            source_branch: item["head"]["ref"].as_str().unwrap_or_default().to_string(),
            target_branch: item["base"]["ref"].as_str().unwrap_or_default().to_string(),
            state: item["state"].as_str().unwrap_or("open").to_string(),
            draft: item["draft"].as_bool().unwrap_or(false),
            web_url: item["html_url"].as_str().unwrap_or(&format!("{web_base}/{owner}/{repo}/pull")).to_string(),
            head_host: item["head"]["repo"]["owner"]["login"].as_str().unwrap_or(owner).to_string(),
            head_owner: item["head"]["repo"]["owner"]["login"].as_str().unwrap_or(owner).to_string(),
            updated_at: item["updated_at"].as_str().unwrap_or_default().to_string(),
            commits: item["commits"].as_u64().map(|count| count as u32),
            assignees: people(Provider::Github, &item["assignees"]),
            reviewers: people(Provider::Github, &item["requested_reviewers"]),
        },
        Provider::Gitlab => ForgeMergeRequest {
            host: host.to_string(),
            number: item["iid"].as_i64()?.to_string(),
            title: item["title"].as_str().unwrap_or_default().to_string(),
            body: item["description"].as_str().unwrap_or_default().to_string(),
            author: item["author"]["username"].as_str().unwrap_or_default().to_string(),
            source_branch: item["source_branch"].as_str().unwrap_or_default().to_string(),
            target_branch: item["target_branch"].as_str().unwrap_or_default().to_string(),
            state: item["state"].as_str().unwrap_or("opened").to_string(),
            draft: item["draft"].as_bool().unwrap_or(false) || item["work_in_progress"].as_bool().unwrap_or(false),
            web_url: item["web_url"].as_str().unwrap_or_default().to_string(),
            head_host: host.to_string(),
            // MR từ fork: project nguồn khác project đích (không biết owner của fork → để trống).
            head_owner: if item["source_project_id"] == item["target_project_id"] { owner.to_string() } else { String::new() },
            updated_at: item["updated_at"].as_str().unwrap_or_default().to_string(),
            commits: None,
            assignees: people(Provider::Gitlab, &item["assignees"]),
            reviewers: people(Provider::Gitlab, &item["reviewers"]),
        },
        Provider::Bitbucket => ForgeMergeRequest {
            host: host.to_string(),
            number: item["id"].as_i64()?.to_string(),
            title: item["title"].as_str().unwrap_or_default().to_string(),
            body: item["description"].as_str().or_else(|| item["summary"]["raw"].as_str()).unwrap_or_default().to_string(),
            author: item["author"]["nickname"].as_str().unwrap_or_default().to_string(),
            source_branch: item["source"]["branch"]["name"].as_str().unwrap_or_default().to_string(),
            target_branch: item["destination"]["branch"]["name"].as_str().unwrap_or_default().to_string(),
            state: item["state"].as_str().unwrap_or_default().to_lowercase(),
            draft: false,
            web_url: item["links"]["html"]["href"].as_str().unwrap_or_default().to_string(),
            head_host: if let Some(href) = item["source"]["repository"]["links"]["html"]["href"].as_str() {
                url::Url::parse(href).ok().and_then(|parsed| parsed.host_str().map(str::to_string))
            } else {
                None
            }
            .unwrap_or_else(|| host.to_string()),
            head_owner: item["source"]["repository"]["full_name"].as_str().unwrap_or_default().split('/').next().unwrap_or(owner).to_string(),
            updated_at: item["updated_on"].as_str().unwrap_or_default().to_string(),
            commits: None,
            assignees: Vec::new(),
            reviewers: people(Provider::Bitbucket, &item["reviewers"]),
        },
    };
    Some(merge_request)
}

/// Một người trong JSON của máy chủ (`None` nếu thiếu tên đăng nhập).
fn person(provider: Provider, user: &serde_json::Value) -> Option<ForgePerson> {
    let text = |key: &str| user[key].as_str().map(str::to_string);
    match provider {
        Provider::Github => Some(ForgePerson { username: text("login")?, name: String::new(), id: None }),
        Provider::Gitlab => Some(ForgePerson {
            username: text("username")?,
            name: text("name").unwrap_or_default(),
            id: user["id"].as_i64(),
        }),
        Provider::Bitbucket => {
            let username = text("nickname").or_else(|| text("display_name")).filter(|name| !name.is_empty())?;
            Some(ForgePerson { username, name: text("display_name").unwrap_or_default(), id: None })
        }
    }
}

/// Mảng người (`assignees`, `reviewers`…) trong JSON; không phải mảng thì rỗng.
fn people(provider: Provider, value: &serde_json::Value) -> Vec<ForgePerson> {
    value.as_array().map(|list| list.iter().filter_map(|user| person(provider, user)).collect()).unwrap_or_default()
}

/// Kiểm tra host + provider trước khi gọi API (webview gửi lên).
pub fn check_host(host: &str, provider: Option<Provider>) -> Result<(String, Provider)> {
    if !valid_host(host) {
        return Err(AppError::Auth(format!("Host không hợp lệ: {host}")));
    }
    let provider = provider_for(host, provider)?;
    Ok((host.to_ascii_lowercase(), provider))
}

/// owner + repo từ webview: chữ, số, `-`, `_`, `.`, `/` và dài có hạn (đi qua `provider_for` để kiểm host).
pub(crate) fn check_repo_path(owner: &str, repo: &str) -> Result<(String, String)> {
    let clean = |value: &str, what: &str| -> Result<String> {
        let trimmed = value.trim().trim_matches('/').to_string();
        if trimmed.is_empty()
            || trimmed.len() > 200
            || !trimmed
                .split('/')
                .all(|segment| segment != "." && segment != ".." && crate::accounts::normalized_owner(segment).is_some())
        {
            return Err(AppError::policy(format!("{what} không hợp lệ")));
        }
        Ok(trimmed)
    };
    Ok((clean(owner, "owner")?, clean(repo, "repo")?))
}

/// Token của tài khoản mặc định (hoặc đã gán) cho `owner` trên host — PR/MR đọc bằng tài khoản có quyền thật.
fn owner_token(accounts: &crate::accounts::Accounts, host: &str, owner: &str) -> Result<(Provider, String)> {
    // Token OAuth sắp hết hạn đã được làm mới bởi người gọi (`refresh_due`).
    let provider = accounts.provider_of(host)?;
    let resolved = accounts
        .resolve(host, Some(owner))
        .ok_or_else(|| AppError::NotFound(format!("Chưa đăng nhập {host} — thêm tài khoản trước đã")))?;
    let token = resolved.token.ok_or_else(|| AppError::Auth(format!("Tài khoản {} trên {host} chưa có token", resolved.login)))?;
    Ok((provider, token))
}

/// PR đang mở của `owner/repo` (webview gửi host + owner + repo; token chọn trong Rust).
pub async fn list_for(
    accounts: &crate::accounts::Accounts,
    host: &str,
    provider: Option<Provider>,
    owner: &str,
    repo: &str,
) -> Result<Vec<ForgeMergeRequest>> {
    let (host, _) = check_host(host, provider)?;
    let (owner, repo) = check_repo_path(owner, repo)?;
    accounts.refresh_due(&host).await;
    let (provider, token) = owner_token(accounts, &host, &owner)?;
    list_merge_requests(&host, provider, &token, &owner, &repo).await
}

/// Tạo PR/MR từ nhánh hiện tại.
#[allow(clippy::too_many_arguments)]
pub async fn create(
    accounts: &crate::accounts::Accounts,
    host: &str,
    provider: Option<Provider>,
    owner: &str,
    repo: &str,
    title: &str,
    body: &str,
    source_branch: &str,
    target_branch: &str,
    draft: bool,
) -> Result<ForgeMergeRequest> {
    let (host, _) = check_host(host, provider)?;
    let (owner, repo) = check_repo_path(owner, repo)?;
    check_branch(source_branch)?;
    check_branch(target_branch)?;
    accounts.refresh_due(&host).await;
    let (provider, token) = owner_token(accounts, &host, &owner)?;
    create_merge_request(&host, provider, &token, &owner, &repo, title, body, source_branch, target_branch, draft).await
}

/// Người có thể gán vào PR / MR của repo: GitHub `assignees`, GitLab thành viên (kể cả thừa hưởng từ nhóm). Bitbucket chưa hỗ trợ.
pub async fn list_assignable(host: &str, provider: Provider, token: &str, owner: &str, repo: &str) -> Result<Vec<ForgePerson>> {
    let client = http()?;
    let base = provider.api_base(host);
    let mut found: Vec<ForgePerson> = Vec::new();
    for page in 1..=MAX_PAGES {
        let url = match provider {
            Provider::Github => format!("{base}/repos/{owner}/{repo}/assignees?per_page=100&page={page}"),
            Provider::Gitlab => {
                format!("{base}/projects/{}/members/all?per_page=100&page={page}", urlencode(&format!("{owner}/{repo}")))
            }
            Provider::Bitbucket => return Err(unsupported_people()),
        };
        let (status, value) = request(&client, reqwest::Method::GET, &url, token, None).await?;
        check_status(provider, host, status, &value)?;
        let raw = value.as_array().cloned().unwrap_or_default();
        if raw.is_empty() {
            break;
        }
        for item in &raw {
            // Thành viên GitLab bị khoá / chờ duyệt không gán được.
            if matches!(provider, Provider::Gitlab) && item["state"].as_str().is_some_and(|state| state != "active") {
                continue;
            }
            let Some(user) = person(provider, item) else { continue };
            if !found.iter().any(|known| known.username.eq_ignore_ascii_case(&user.username)) {
                found.push(user);
            }
        }
        if raw.len() < 100 {
            break;
        }
    }
    Ok(found)
}

fn unsupported_people() -> AppError {
    AppError::policy("Bitbucket chưa hỗ trợ gán người ở đây — làm trên trang web")
}

/// Đặt lại danh sách người review hoặc người được gán của PR / MR rồi đọc lại PR / MR (kết quả thật của máy chủ).
/// GitHub: assignees thay cả danh sách bằng một lệnh; reviewers so với danh sách hiện có để chỉ bỏ / thêm phần khác biệt.
/// GitLab: `assignee_ids` / `reviewer_ids` (danh sách rỗng gửi `[0]` = bỏ hết).
#[allow(clippy::too_many_arguments)]
pub async fn set_people(
    host: &str,
    provider: Provider,
    token: &str,
    owner: &str,
    repo: &str,
    number: &str,
    role: PeopleRole,
    people: &[ForgePerson],
) -> Result<ForgeMergeRequest> {
    let client = http()?;
    let base = provider.api_base(host);
    match provider {
        Provider::Github => {
            if let Some(bad) = people.iter().find(|user| !valid_login(&user.username)) {
                return Err(AppError::policy(format!("Tên người dùng không hợp lệ: {}", bad.username)));
            }
            match role {
                PeopleRole::Assignees => {
                    let url = format!("{base}/repos/{owner}/{repo}/issues/{number}");
                    let logins: Vec<&str> = people.iter().map(|user| user.username.as_str()).collect();
                    let payload = serde_json::json!({ "assignees": logins });
                    let (status, value) = request(&client, reqwest::Method::PATCH, &url, token, Some(&payload)).await?;
                    check_status(provider, host, status, &value)?;
                }
                PeopleRole::Reviewers => {
                    let current = fetch_merge_request(host, provider, token, owner, repo, number).await?;
                    let (add, remove) = reviewer_changes(&current.reviewers, people);
                    let url = format!("{base}/repos/{owner}/{repo}/pulls/{number}/requested_reviewers");
                    // Bỏ trước, thêm sau; mỗi nhóm một lệnh gọi (nhóm rỗng thì không gọi).
                    for (method, logins) in [(reqwest::Method::DELETE, remove), (reqwest::Method::POST, add)] {
                        if logins.is_empty() {
                            continue;
                        }
                        let payload = serde_json::json!({ "reviewers": logins });
                        let (status, value) = request(&client, method, &url, token, Some(&payload)).await?;
                        check_status(provider, host, status, &value)?;
                    }
                }
            }
        }
        Provider::Gitlab => {
            let mut ids = Vec::with_capacity(people.len());
            for user in people {
                ids.push(user.id.ok_or_else(|| AppError::policy("Thiếu id người dùng GitLab"))?);
            }
            if ids.is_empty() {
                ids.push(0);
            }
            let key = match role {
                PeopleRole::Assignees => "assignee_ids",
                PeopleRole::Reviewers => "reviewer_ids",
            };
            let url = format!("{base}/projects/{}/merge_requests/{number}", urlencode(&format!("{owner}/{repo}")));
            let mut fields = serde_json::Map::new();
            fields.insert(key.to_string(), serde_json::json!(ids));
            let payload = serde_json::Value::Object(fields);
            let (status, value) = request(&client, reqwest::Method::PUT, &url, token, Some(&payload)).await?;
            check_status(provider, host, status, &value)?;
        }
        Provider::Bitbucket => return Err(unsupported_people()),
    }
    fetch_merge_request(host, provider, token, owner, repo, number).await
}

/// Tên đăng nhập GitHub (chữ, số, `-`, `_`, `.`; dài có hạn; `[` `]` cho tài khoản bot như `app[bot]`) — đi vào thân JSON chứ
/// không vào URL, nhưng vẫn không nhận ký tự lạ.
fn valid_login(login: &str) -> bool {
    !login.is_empty()
        && login.len() <= 100
        && login.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '[' | ']'))
}

/// Từ danh sách review hiện có và danh sách mong muốn: (cần thêm, cần bỏ) — so tên đăng nhập không phân biệt hoa thường.
fn reviewer_changes<'a>(current: &'a [ForgePerson], wanted: &'a [ForgePerson]) -> (Vec<&'a str>, Vec<&'a str>) {
    let has = |list: &[ForgePerson], login: &str| list.iter().any(|user| user.username.eq_ignore_ascii_case(login));
    let add = wanted.iter().filter(|user| !has(current, &user.username)).map(|user| user.username.as_str()).collect();
    let remove = current.iter().filter(|user| !has(wanted, &user.username)).map(|user| user.username.as_str()).collect();
    (add, remove)
}

/// Người có thể gán của `owner/repo` (webview gửi host + owner + repo; token chọn trong Rust).
pub async fn assignable_for(
    accounts: &crate::accounts::Accounts,
    host: &str,
    provider: Option<Provider>,
    owner: &str,
    repo: &str,
) -> Result<Vec<ForgePerson>> {
    let (host, _) = check_host(host, provider)?;
    let (owner, repo) = check_repo_path(owner, repo)?;
    accounts.refresh_due(&host).await;
    let (provider, token) = owner_token(accounts, &host, &owner)?;
    list_assignable(&host, provider, &token, &owner, &repo).await
}

/// Đặt lại người review / người được gán của một PR / MR của `owner/repo`.
#[allow(clippy::too_many_arguments)]
pub async fn set_people_for(
    accounts: &crate::accounts::Accounts,
    host: &str,
    provider: Option<Provider>,
    owner: &str,
    repo: &str,
    number: &str,
    role: PeopleRole,
    people: &[ForgePerson],
) -> Result<ForgeMergeRequest> {
    let (host, _) = check_host(host, provider)?;
    let (owner, repo) = check_repo_path(owner, repo)?;
    if number.is_empty() || number.len() > 12 || !number.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::policy("Số PR / MR không hợp lệ"));
    }
    if people.len() > 100 {
        return Err(AppError::policy("Quá nhiều người được chọn"));
    }
    accounts.refresh_due(&host).await;
    let (provider, token) = owner_token(accounts, &host, &owner)?;
    set_people(&host, provider, &token, &owner, &repo, number, role, people).await
}

/// Tên nhánh hợp lệ cho `git` (không ký tự lạ, không khoảng trắng) — cũng chặn ký tự điều khiển.
fn check_branch(branch: &str) -> Result<()> {
    let trimmed = branch.trim();
    let ok = !trimmed.is_empty()
        && trimmed.len() <= 255
        && !trimmed.starts_with('-')
        && !trimmed.chars().any(|c| c.is_control() || c.is_whitespace())
        && !trimmed.contains("..")
        && !trimmed.contains("@{")
        && !trimmed.ends_with(".lock");
    if ok { Ok(()) } else { Err(AppError::policy("Tên nhánh không hợp lệ")) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_bases_follow_the_host() {
        assert_eq!(Provider::Github.api_base("github.com"), "https://api.github.com");
        assert_eq!(Provider::Github.api_base("git.acme.vn"), "https://git.acme.vn/api/v3");
        assert_eq!(Provider::Gitlab.api_base("gitlab.com"), "https://gitlab.com/api/v4");
        assert_eq!(Provider::Bitbucket.api_base("bitbucket.org"), "https://api.bitbucket.org/2.0");
    }

    #[test]
    fn github_pull_requests_are_parsed() {
        let item = serde_json::json!({
            "number": 42,
            "title": "Thêm tính năng",
            "body": "Mô tả",
            "user": { "login": "alice" },
            "head": { "ref": "feat/x", "repo": { "owner": { "login": "alice" } } },
            "base": { "ref": "main" },
            "state": "open",
            "draft": true,
            "html_url": "https://github.com/acme/app/pull/42",
            "updated_at": "2026-10-03T00:00:00Z",
            "commits": 3,
        });
        let parsed = parse_merge_request("github.com", Provider::Github, "acme", "app", &item).unwrap();
        assert_eq!(parsed.number, "42");
        assert_eq!(parsed.source_branch, "feat/x");
        assert_eq!(parsed.target_branch, "main");
        assert_eq!(parsed.author, "alice");
        assert!(parsed.draft);
        assert_eq!(parsed.commits, Some(3));
    }

    #[test]
    fn gitlab_merge_requests_use_iid_and_read_description() {
        let item = serde_json::json!({
            "iid": 7,
            "title": "Sửa lỗi",
            "description": "Chi tiết",
            "author": { "username": "bob" },
            "source_branch": "fix/y",
            "target_branch": "main",
            "state": "opened",
            "work_in_progress": true,
            "web_url": "https://gitlab.com/acme/app/-/merge_requests/7",
        });
        let parsed = parse_merge_request("gitlab.com", Provider::Gitlab, "acme", "app", &item).unwrap();
        assert_eq!(parsed.number, "7");
        assert_eq!(parsed.body, "Chi tiết");
        assert!(parsed.draft);
        assert_eq!(parsed.head_owner, "acme");
        let mut fork = item.clone();
        fork["source_project_id"] = serde_json::json!(11);
        fork["target_project_id"] = serde_json::json!(10);
        assert_eq!(parse_merge_request("gitlab.com", Provider::Gitlab, "acme", "app", &fork).unwrap().head_owner, "");
    }

    #[test]
    fn bitbucket_pull_requests_read_nested_links() {
        let item = serde_json::json!({
            "id": 9,
            "title": "PR",
            "description": "d",
            "author": { "nickname": "carol" },
            "source": { "branch": { "name": "s" }, "repository": { "full_name": "carol/app", "links": { "html": { "href": "https://bitbucket.org/carol/app" } } } },
            "destination": { "branch": { "name": "main" } },
            "state": "OPEN",
            "links": { "html": { "href": "https://bitbucket.org/carol/app/pull-requests/9" } },
        });
        let parsed = parse_merge_request("bitbucket.org", Provider::Bitbucket, "carol", "app", &item).unwrap();
        assert_eq!(parsed.number, "9");
        assert_eq!(parsed.state, "open");
        assert_eq!(parsed.head_owner, "carol");
        assert_eq!(parsed.head_host, "bitbucket.org");
    }

    #[test]
    fn statuses_map_to_friendly_errors() {
        let body = serde_json::json!({});
        assert_eq!(check_status(Provider::Github, "github.com", 200, &body).unwrap(), ());
        assert_eq!(check_status(Provider::Github, "github.com", 401, &body).unwrap_err().code(), "auth");
        assert_eq!(check_status(Provider::Github, "github.com", 404, &body).unwrap_err().code(), "not-found");
        assert_eq!(check_status(Provider::Github, "github.com", 422, &body).unwrap_err().code(), "conflict");
        assert_eq!(check_status(Provider::Github, "github.com", 429, &body).unwrap_err().code(), "io");
        assert_eq!(check_status(Provider::Github, "github.com", 503, &body).unwrap_err().code(), "io");
    }

    #[test]
    fn people_are_read_from_each_provider() {
        let github = serde_json::json!({
            "number": 1,
            "assignees": [{ "login": "an" }],
            "requested_reviewers": [{ "login": "binh" }, { "login": "chi" }, { "id": 5 }],
        });
        let parsed = parse_merge_request("github.com", Provider::Github, "acme", "app", &github).unwrap();
        assert_eq!(parsed.assignees, vec![ForgePerson { username: "an".into(), name: String::new(), id: None }]);
        assert_eq!(parsed.reviewers.iter().map(|user| user.username.as_str()).collect::<Vec<_>>(), ["binh", "chi"]);

        let gitlab = serde_json::json!({
            "iid": 7,
            "assignees": [{ "id": 2, "username": "binh", "name": "Bình" }],
            "reviewers": [{ "id": 3, "username": "chi", "name": "Chi" }],
        });
        let parsed = parse_merge_request("gitlab.com", Provider::Gitlab, "acme", "app", &gitlab).unwrap();
        assert_eq!(parsed.assignees, vec![ForgePerson { username: "binh".into(), name: "Bình".into(), id: Some(2) }]);
        assert_eq!(parsed.reviewers[0].id, Some(3));

        let bitbucket = serde_json::json!({
            "id": 9,
            "reviewers": [{ "nickname": "dung", "display_name": "Dũng" }, { "display_name": "Chỉ tên" }, {}],
        });
        let parsed = parse_merge_request("bitbucket.org", Provider::Bitbucket, "acme", "app", &bitbucket).unwrap();
        assert!(parsed.assignees.is_empty());
        assert_eq!(parsed.reviewers.len(), 2);
        assert_eq!(parsed.reviewers[0].username, "dung");
        assert_eq!(parsed.reviewers[0].name, "Dũng");
        assert_eq!(parsed.reviewers[1].username, "Chỉ tên");

        // Không có trường người → danh sách rỗng, không lỗi.
        let bare = serde_json::json!({ "number": 2 });
        let parsed = parse_merge_request("github.com", Provider::Github, "acme", "app", &bare).unwrap();
        assert!(parsed.assignees.is_empty() && parsed.reviewers.is_empty());
    }

    #[test]
    fn reviewer_changes_only_touch_the_difference() {
        let person = |name: &str| ForgePerson { username: name.to_string(), name: String::new(), id: None };
        let current = vec![person("An"), person("binh")];
        let wanted = vec![person("an"), person("Chi")];
        let (add, remove) = reviewer_changes(&current, &wanted);
        assert_eq!(add, ["Chi"]);
        assert_eq!(remove, ["binh"]);
        let (add, remove) = reviewer_changes(&wanted, &wanted);
        assert!(add.is_empty() && remove.is_empty());
        let (add, remove) = reviewer_changes(&[], &[]);
        assert!(add.is_empty() && remove.is_empty());
    }

    #[test]
    fn github_logins_are_checked_before_going_into_a_request() {
        for ok in ["an", "an-nguyen", "a_b.c", "copilot[bot]"] {
            assert!(valid_login(ok), "{ok}");
        }
        let long = "x".repeat(101);
        for bad in ["", "a b", "a\"b", "a/b", "a\nb", long.as_str()] {
            assert!(!valid_login(bad), "{bad:?}");
        }
    }

    #[test]
    fn people_role_and_person_come_from_the_webview_as_camel_case() {
        let role: PeopleRole = serde_json::from_str("\"reviewers\"").unwrap();
        assert_eq!(role, PeopleRole::Reviewers);
        assert!(serde_json::from_str::<PeopleRole>("\"owners\"").is_err());
        let user: ForgePerson = serde_json::from_str(r#"{"username":"an","id":5}"#).unwrap();
        assert_eq!(user, ForgePerson { username: "an".into(), name: String::new(), id: Some(5) });
        let only_name: ForgePerson = serde_json::from_str(r#"{"username":"an"}"#).unwrap();
        assert_eq!(only_name.id, None);
        assert_eq!(serde_json::to_value(&user).unwrap()["username"], "an");
    }

    #[test]
    fn merge_request_urls_cover_each_provider() {
        assert_eq!(
            merge_request_list_url(Provider::Github, "https://api.github.com", "acme", "app", 1),
            "https://api.github.com/repos/acme/app/pulls?state=open&per_page=100&page=1"
        );
        assert_eq!(
            merge_request_list_url(Provider::Gitlab, "https://gitlab.com/api/v4", "acme", "app", 2),
            "https://gitlab.com/api/v4/projects/acme%2Fapp/merge_requests?state=opened&per_page=100&page=2&order_by=updated_at"
        );
        assert_eq!(
            merge_request_list_url(Provider::Bitbucket, "https://api.bitbucket.org/2.0", "carol", "app", 1),
            "https://api.bitbucket.org/2.0/repositories/carol/app/pullrequests?state=OPEN&pagelen=50&page=1"
        );
    }

    #[test]
    fn branch_and_repo_paths_are_checked_before_any_request() {
        assert!(check_branch("feat/x").is_ok());
        for bad in ["", "-x", "a b", "a..b", "a@{0}", "x.lock", "a\nb"] {
            assert!(check_branch(bad).is_err(), "{bad}");
        }
        assert_eq!(check_repo_path("acme", "app").unwrap(), ("acme".to_string(), "app".to_string()));
        assert_eq!(check_repo_path("group", "sub/app").unwrap(), ("group".to_string(), "sub/app".to_string()));
        assert!(check_repo_path("acme", "a b").is_err());
        assert!(check_repo_path("", "app").is_err());
        assert!(check_repo_path("acme", "..").is_err());
    }

    #[test]
    fn device_flow_stays_on_the_host_it_was_started_for() {
        assert_eq!(device_flow_urls("github.com", Provider::Github).0, "https://github.com/login/device/code");
        assert_eq!(device_flow_urls("git.acme.vn", Provider::Github).1, "https://git.acme.vn/login/oauth/access_token");
        assert_eq!(device_flow_urls("gitlab.com", Provider::Gitlab).1, "https://gitlab.com/oauth/token");
        assert_eq!(same_host_page("https://github.com/login/device", "github.com"), "https://github.com/login/device");
        for evil in ["https://github.com.evil.vn/login", "http://github.com/login/device", "https://evil.vn/?https://github.com", "javascript:x"] {
            assert_eq!(same_host_page(evil, "github.com"), "https://github.com/login/device", "{evil}");
        }
    }

    #[test]
    fn repositories_get_a_clone_url_on_the_checked_host() {
        let item = serde_json::json!({
            "path_with_namespace": "group/app",
            "name": "app",
            "visibility": "private",
            "http_url_to_repo": "https://evil.vn/group/app.git",
        });
        let repo = parse_repository("gitlab.com", Provider::Gitlab, &item, "bob").unwrap();
        assert_eq!(repo.clone_url, "https://gitlab.com/group/app.git");
        assert!(repo.is_private);
        assert_eq!(serde_json::to_value(&repo).unwrap()["cloneUrl"], "https://gitlab.com/group/app.git");
    }

    #[test]
    fn only_github_and_gitlab_have_device_flow() {
        assert!(Provider::Github.supports_device_flow());
        assert!(Provider::Gitlab.supports_device_flow());
        assert!(!Provider::Bitbucket.supports_device_flow());
        assert!(!scopes(Provider::Bitbucket).contains("repo"));
    }
}