//! Calls the git host's API: sign-in (OAuth device flow or a token the user pasted), reading the repo, organisation and
//! Pull Request / Merge Request lists. Every request goes out from Rust (the webview has no HTTP scope), the token only
//! lives in a local variable, and it never reaches the log.

use serde::{Deserialize, Serialize};

use crate::accounts::{Provider, provider_for, valid_host};
use crate::errors::{AppError, Result};

const USER_AGENT: &str = concat!("Thaigit/", env!("CARGO_PKG_VERSION"));
const MAX_ITEMS: usize = 200;
const REQUEST_TIMEOUT_S: u64 = 30;

/// Max pages when reading a list (100 / 20 items per page depending on the API).
const MAX_PAGES: u32 = 5;

fn http() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_S))
        // The token travels in the `Authorization` header; never let reqwest put it in the URL (a redirect could change host).
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| AppError::Internal(format!("Không tạo được HTTP client: {error}")))
}

/// One request: URL built from a validated host, token in the header. JSON only.
async fn request(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: &str,
    token: &str,
    body: Option<&serde_json::Value>,
) -> Result<(u16, serde_json::Value)> {
    let mut builder = client.request(method, url).header("Accept", "application/json");
    // The device flow's request-code / token-poll steps have no token yet: do not send an empty header.
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

/// A host error code → a normalised error (the UI shows a friendly sentence, the technical detail goes to the Command log).
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
        // The host understood the request but refused it (source branch not pushed, a PR already exists for that branch…).
        409 | 422 => {
            let message = body["message"].as_str().unwrap_or_default();
            Err(AppError::Conflict(format!("Máy chủ {host} không nhận yêu cầu ({status}): {message}")))
        }
        429 => Err(AppError::Io(format!("Máy chủ {host} giới hạn số yêu cầu — thử lại sau ít phút"))),
        500..=599 => Err(AppError::Io(format!("Máy chủ {host} đang lỗi ({status}) — thử lại sau"))),
        _ => Err(AppError::Io(format!("Máy chủ {host} trả lỗi {status}"))),
    }
}

/// Account identity read from the API (no token).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    pub login: String,
    pub display_name: String,
    /// The server's id (GitHub uses it for the private email address).
    pub id: String,
}

/// A repository the account can access.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeRepository {
    pub host: String,
    pub path: String,
    pub name: String,
    pub default_branch: String,
    pub is_private: bool,
    pub web_url: String,
    /// HTTPS clone URL without a token (the token travels through the app's credential helper).
    pub clone_url: String,
}

/// A Pull Request (GitHub / Bitbucket) or Merge Request (GitLab) — one type, so the UI renders them identically.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeMergeRequest {
    pub host: String,
    /// The PR/MR number (GitHub) or `iid` (GitLab / Bitbucket).
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
    /// Commit / change count when the API has it (GitHub has `commits`).
    pub commits: Option<u32>,
    /// The current assignee (Bitbucket has no such concept).
    pub assignees: Vec<ForgePerson>,
    /// The requested reviewer.
    pub reviewers: Vec<ForgePerson>,
}

/// A user on the server who can be assigned to PRs / MRs (or already is).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgePerson {
    pub username: String,
    /// Display name (may be empty: GitHub's user list only carries `login`).
    #[serde(default)]
    pub name: String,
    /// GitLab assigns users by numeric id; GitHub assigns by `username` (no id available).
    #[serde(default)]
    pub id: Option<i64>,
}

/// Which list of a PR / MR is being changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PeopleRole {
    Reviewers,
    Assignees,
}

/// The device-flow (OAuth) sign-in screen's data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u32,
    pub interval: u32,
    /// RFC 8628's temporary secret: the webview holds it to poll for a token; it expires together with the user code and is not a long-lived token.
    pub device_code: String,
}

/// Scopes to request when signing in with the device flow.
pub fn scopes(provider: Provider) -> &'static str {
    match provider {
        Provider::Github => "repo workflow read:org write:public_key",
        Provider::Gitlab => "api read_api read_user read_repository",
        // Bitbucket has no device flow.
        Provider::Bitbucket => "",
    }
}

// MARK: - SSH keys

/// Result of uploading an SSH public key to an account.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SshKeyUpload {
    Added,
    AlreadyExists,
    /// The token lacks the key-upload scope (GitHub: `write:public_key`, GitLab: `api`) or the host does not support it: the user pastes it on the web page.
    MissingScope,
}

/// Add an SSH public key to the account (GitHub and GitLab's `POST /user/keys`).
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

/// The host's page for adding an SSH key manually.
pub fn ssh_keys_page(host: &str, provider: Provider) -> String {
    match provider {
        Provider::Github => format!("https://{host}/settings/ssh/new"),
        Provider::Gitlab => format!("https://{host}/-/user_settings/ssh_keys"),
        Provider::Bitbucket => "https://bitbucket.org/account/settings/ssh-keys/".to_string(),
    }
}

// MARK: - Device flow

/// Device-flow endpoints on a host: (request code, poll for token). GitHub Enterprise uses that very host.
fn device_flow_urls(host: &str, provider: Provider) -> (String, String) {
    match provider {
        Provider::Github => (format!("https://{host}/login/device/code"), format!("https://{host}/login/oauth/access_token")),
        // GitLab: the registered application's id (a public client, no secret needed).
        _ => (format!("https://{host}/oauth/authorize_device"), format!("https://{host}/oauth/token")),
    }
}

/// The page where the user types the code: only an https page on exactly that host (a tampered response still cannot open a foreign page).
fn same_host_page(uri: &str, host: &str) -> String {
    let fallback = format!("https://{host}/login/device");
    match url::Url::parse(uri) {
        Ok(parsed) if parsed.scheme() == "https" && parsed.host_str().is_some_and(|h| h.eq_ignore_ascii_case(host)) => uri.to_string(),
        _ => fallback,
    }
}

/// Step 1: request the code the user types on the host's page.
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

/// The OAuth token the host issued. GitLab: tokens live ~2 hours and come with a refresh token (a GitHub OAuth App token does not expire).
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

/// Result of one device-flow token poll.
#[derive(Debug, PartialEq, Eq)]
pub enum PollOutcome {
    /// The user has not confirmed yet: poll again after `interval`.
    Pending,
    /// The host asked us to slow down (RFC 8628): add 5 seconds to `interval`.
    SlowDown,
    Token(TokenGrant),
}

/// Refresh an OAuth token with the refresh token (a public client needs only the client id). The old refresh token expires after this call.
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

/// Step 2: poll for the token once (the UI retries every `interval` until the user confirms).
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
            // Status 200 but no token: the host answered unexpectedly — poll again instead of reporting a sign-in failure.
            Ok(PollOutcome::Pending)
        }
    }
}

// MARK: - Identity, organisations, repositories

/// Read the account identity from a token (used to validate a token before storing it).
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

/// Organisations / groups / workspaces the account belongs to — used to pick a token by owner.
pub async fn fetch_organizations(host: &str, provider: Provider, token: &str) -> Result<Vec<String>> {
    let client = http()?;
    let base = provider.api_base(host);
    let mut names: Vec<String> = Vec::new();
    for (page, url) in pages(provider, &base, "orgs", "groups", 100).into_iter().enumerate() {
        let (status, value) = request(&client, reqwest::Method::GET, &url, token, None).await?;
        // GitHub returns 403 when the token lacks `read:org` — organisations only pick a token, so leaving them empty is fine.
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

/// The account's repository list (for the Clone dialog).
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

/// Per-page URL of the repo-list endpoint. Bitbucket Cloud needs a workspace, so it cannot paginate with `page`.
fn repository_pages(provider: Provider, host: &str, base: &str, login: &str) -> Vec<String> {
    match provider {
        Provider::Github => {
            (1..=MAX_PAGES)
                .map(|page| format!("{base}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member&page={page}"))
                .collect()
        }
        Provider::Gitlab => (1..=MAX_PAGES).map(|page| format!("{base}/projects?membership=true&per_page=100&page={page}&order_by=last_activity_at")).collect(),
        // `login` is the Bitbucket account's workspace.
        Provider::Bitbucket => {
            let _ = host;
            vec![format!("{base}/repositories/{}?role=member&sort=-updated_on&pagelen=100", urlencode(login))]
        }
    }
}

/// Per-page URL of the organisation endpoint.
fn pages(provider: Provider, base: &str, github: &str, gitlab: &str, per_page: u32) -> Vec<String> {
    match provider {
        Provider::Github => (1..=MAX_PAGES).map(|page| format!("{base}/user/{github}?per_page={per_page}&page={page}")).collect(),
        Provider::Gitlab => (1..=MAX_PAGES).map(|page| format!("{base}/{gitlab}?per_page={per_page}&page={page}")).collect(),
        // A Bitbucket workspace comes from elsewhere (`fetch_identity` calls for it); no paging needed here.
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

/// The repository's open PRs.
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

/// Create a PR / MR from the current branch.
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

/// One specific PR (used when the commit count / detailed state is needed).
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
            // An MR from a fork: the source project differs from the target project (the fork's owner is unknown → left empty).
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

/// One user in the host's JSON (`None` when the login is missing).
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

/// The user array (`assignees`, `reviewers`…) in the JSON; empty when it is not an array.
fn people(provider: Provider, value: &serde_json::Value) -> Vec<ForgePerson> {
    value.as_array().map(|list| list.iter().filter_map(|user| person(provider, user)).collect()).unwrap_or_default()
}

/// Validate host + provider before calling the API (both sent by the webview).
pub fn check_host(host: &str, provider: Option<Provider>) -> Result<(String, Provider)> {
    if !valid_host(host) {
        return Err(AppError::Auth(format!("Host không hợp lệ: {host}")));
    }
    let provider = provider_for(host, provider)?;
    Ok((host.to_ascii_lowercase(), provider))
}

/// owner + repo from the webview: letters, digits, `-`, `_`, `.`, `/` and bounded length (goes through `provider_for` so the host is validated).
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

/// Token of the default (or assigned) account for `owner` on the host — PRs / MRs are read with an account that really has access.
fn owner_token(accounts: &crate::accounts::Accounts, host: &str, owner: &str) -> Result<(Provider, String)> {
    // An OAuth token about to expire was already refreshed by the caller (`refresh_due`).
    let provider = accounts.provider_of(host)?;
    let resolved = accounts
        .resolve(host, Some(owner))
        .ok_or_else(|| AppError::NotFound(format!("Chưa đăng nhập {host} — thêm tài khoản trước đã")))?;
    let token = resolved.token.ok_or_else(|| AppError::Auth(format!("Tài khoản {} trên {host} chưa có token", resolved.login)))?;
    Ok((provider, token))
}

/// Open PRs of `owner/repo` (the webview sends host + owner + repo; the token is chosen in Rust).
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

/// Create a PR / MR from the current branch.
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

/// Users who can be assigned to the repo's PRs / MRs: GitHub `assignees`, GitLab members (including inherited from groups). Bitbucket does not support it yet.
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
            // A locked or still-pending GitLab member cannot be assigned.
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

/// Replace the reviewer or assignee list of a PR / MR, then re-read the PR / MR (the host's real result).
/// GitHub: assignees replace the whole list in one call; reviewers are diffed against the current list so only the difference is removed / added.
/// GitLab: `assignee_ids` / `reviewer_ids` (an empty list sends `[0]` = clear them all).
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
                    // Remove first, add after; one call per group (an empty group makes no call).
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

/// A GitHub login (letters, digits, `-`, `_`, `.`; bounded length; `[` and `]` for bot accounts such as `app[bot]`) — it goes
/// into the JSON body rather than a URL, but odd characters are still rejected.
fn valid_login(login: &str) -> bool {
    !login.is_empty()
        && login.len() <= 100
        && login.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '[' | ']'))
}

/// From the current reviewer list and the desired one: (to add, to remove) — comparing logins case-insensitively.
fn reviewer_changes<'a>(current: &'a [ForgePerson], wanted: &'a [ForgePerson]) -> (Vec<&'a str>, Vec<&'a str>) {
    let has = |list: &[ForgePerson], login: &str| list.iter().any(|user| user.username.eq_ignore_ascii_case(login));
    let add = wanted.iter().filter(|user| !has(current, &user.username)).map(|user| user.username.as_str()).collect();
    let remove = current.iter().filter(|user| !has(wanted, &user.username)).map(|user| user.username.as_str()).collect();
    (add, remove)
}

/// Users who can be assigned in `owner/repo` (the webview sends host + owner + repo; the token is chosen in Rust).
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

/// Replace the reviewers / assignees of one PR / MR of `owner/repo`.
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

/// Post one general (non-diff-level) comment on a PR / MR. Returns the comment URL when the host provides one.
pub async fn add_comment_for(
    accounts: &crate::accounts::Accounts,
    host: &str,
    provider: Option<Provider>,
    owner: &str,
    repo: &str,
    number: &str,
    body: &str,
) -> Result<String> {
    if body.trim().is_empty() {
        return Err(AppError::policy("Nội dung bình luận không được để trống"));
    }
    let (host, _provider) = check_host(host, provider)?;
    let (owner, repo) = check_repo_path(owner, repo)?;
    if number.is_empty() || number.len() > 12 || !number.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::policy("Số PR / MR không hợp lệ"));
    }
    accounts.refresh_due(&host).await;
    let (provider, token) = owner_token(accounts, &host, &owner)?;
    let client = http()?;
    let base = provider.api_base(&host);
    let (url, payload) = match provider {
        Provider::Github => (
            format!("{base}/repos/{owner}/{repo}/issues/{number}/comments"),
            serde_json::json!({ "body": body }),
        ),
        Provider::Gitlab => (
            format!("{base}/projects/{}/merge_requests/{number}/notes", urlencode(&format!("{owner}/{repo}"))),
            serde_json::json!({ "body": body }),
        ),
        Provider::Bitbucket => (
            format!("{base}/repositories/{owner}/{repo}/pullrequests/{number}/comments"),
            serde_json::json!({ "content": { "raw": body } }),
        ),
    };
    let (status, value) = request(&client, reqwest::Method::POST, &url, &token, Some(&payload)).await?;
    check_status(provider, &host, status, &value)?;
    let link = match provider {
        Provider::Github => value["html_url"].as_str(),
        Provider::Gitlab => value["url"].as_str().or_else(|| value["web_url"].as_str()),
        Provider::Bitbucket => value["links"]["html"]["href"].as_str(),
    }
    .unwrap_or_default()
    .to_string();
    Ok(link)
}

/// Approve a PR / MR. `true` when the host accepted the approval.
pub async fn approve_for(
    accounts: &crate::accounts::Accounts,
    host: &str,
    provider: Option<Provider>,
    owner: &str,
    repo: &str,
    number: &str,
) -> Result<()> {
    let (host, _provider) = check_host(host, provider)?;
    let (owner, repo) = check_repo_path(owner, repo)?;
    if number.is_empty() || number.len() > 12 || !number.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::policy("Số PR / MR không hợp lệ"));
    }
    accounts.refresh_due(&host).await;
    let (provider, token) = owner_token(accounts, &host, &owner)?;
    let client = http()?;
    let base = provider.api_base(&host);
    let (method, url, payload) = match provider {
        Provider::Github => (
            reqwest::Method::POST,
            format!("{base}/repos/{owner}/{repo}/pulls/{number}/reviews"),
            Some(serde_json::json!({ "event": "APPROVE" })),
        ),
        Provider::Gitlab => (
            reqwest::Method::POST,
            format!("{base}/projects/{}/merge_requests/{number}/approve", urlencode(&format!("{owner}/{repo}"))),
            Some(serde_json::json!({})),
        ),
        Provider::Bitbucket => (
            reqwest::Method::POST,
            format!("{base}/repositories/{owner}/{repo}/pullrequests/{number}/approve"),
            Some(serde_json::json!({})),
        ),
    };
    let (status, value) = request(&client, method, &url, &token, payload.as_ref()).await?;
    check_status(provider, &host, status, &value)?;
    Ok(())
}

/// The merge strategy for a PR / MR.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MergeMethod {
    Merge,
    Squash,
    Rebase,
}

/// Merge a PR / MR. `true` when the host accepted it.
pub async fn merge_for(
    accounts: &crate::accounts::Accounts,
    host: &str,
    provider: Option<Provider>,
    owner: &str,
    repo: &str,
    number: &str,
    method: MergeMethod,
) -> Result<()> {
    let (host, _provider) = check_host(host, provider)?;
    let (owner, repo) = check_repo_path(owner, repo)?;
    if number.is_empty() || number.len() > 12 || !number.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::policy("Số PR / MR không hợp lệ"));
    }
    accounts.refresh_due(&host).await;
    let (provider, token) = owner_token(accounts, &host, &owner)?;
    let client = http()?;
    let base = provider.api_base(&host);
    let (method_, url, payload) = match provider {
        Provider::Github => {
            let merge_method = match method {
                MergeMethod::Merge => "merge",
                MergeMethod::Squash => "squash",
                MergeMethod::Rebase => "rebase",
            };
            (
                reqwest::Method::PUT,
                format!("{base}/repos/{owner}/{repo}/pulls/{number}/merge"),
                Some(serde_json::json!({ "merge_method": merge_method })),
            )
        }
        Provider::Gitlab => (
            reqwest::Method::PUT,
            format!("{base}/projects/{}/merge_requests/{number}/merge", urlencode(&format!("{owner}/{repo}"))),
            Some(match method {
                MergeMethod::Merge | MergeMethod::Rebase => serde_json::json!({}),
                MergeMethod::Squash => serde_json::json!({ "squash": true }),
            }),
        ),
        Provider::Bitbucket => (
            reqwest::Method::POST,
            format!("{base}/repositories/{owner}/{repo}/pullrequests/{number}/merge"),
            Some(serde_json::json!({})),
        ),
    };
    let (status, value) = request(&client, method_, &url, &token, payload.as_ref()).await?;
    check_status(provider, &host, status, &value)?;
    Ok(())
}

/// A branch name valid for `git` (no odd characters, no whitespace) — control characters are blocked too.
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

        // No user field → an empty list, not an error.
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