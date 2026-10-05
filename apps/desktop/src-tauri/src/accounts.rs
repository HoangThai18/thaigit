//! Tài khoản git trên các máy chủ đã biết (GitHub / GitLab / Bitbucket): phần KHÔNG bí mật nằm trong
//! `<data>/accounts.json`, token nằm trong kho bí mật của hệ điều hành (Keychain / Credential Manager).
//!
//! Nhiều tài khoản cho cùng một máy chủ (repo cá nhân + repo công ty): `resolve(host, owner)` chọn token theo thứ tự
//! người dùng tự gán → owner trùng login → tổ chức mà tài khoản là thành viên → tài khoản mặc định của host đó.
//! `credential.rs` dùng kết quả này để trả lời git, nên token không bao giờ nằm trong env của tiến trình con.
//!
//! Webview không tin cậy: mọi giá trị do frontend gửi (host, login, owner, token) đều được kiểm ở đây.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::errors::{AppError, Result};

/// Dịch vụ bí mật: giá trị trả về là token thô, chỉ sống trong tiến trình của Rust.
pub trait SecretStore: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<String>>;
    fn set(&self, key: &str, secret: &str) -> Result<()>;
    fn delete(&self, key: &str) -> Result<()>;
}

/// Kho bí mật của hệ điều hành. Lỗi ở đây (khoá bị khoá, không có quyền) là lỗi `auth` để UI gợi ý mở khoá.
pub struct KeychainStore {
    service: String,
}

impl KeychainStore {
    pub fn new(service: &str) -> Self {
        Self { service: service.to_string() }
    }
}

impl SecretStore for KeychainStore {
    fn get(&self, key: &str) -> Result<Option<String>> {
        match keyring::v1::Entry::new(&self.service, key) {
            Err(error) => Err(secret_error("mở kho bí mật", error)),
            Ok(entry) => match entry.get_password() {
                Ok(secret) => Ok(Some(secret)),
                Err(keyring::v1::Error::NoEntry) => Ok(None),
                Err(error) => Err(secret_error("đọc token", error)),
            },
        }
    }

    fn set(&self, key: &str, secret: &str) -> Result<()> {
        let entry = keyring::v1::Entry::new(&self.service, key).map_err(|e| secret_error("mở kho bí mật", e))?;
        entry.set_password(secret).map_err(|e| secret_error("lưu token", e))
    }

    fn delete(&self, key: &str) -> Result<()> {
        let entry = keyring::v1::Entry::new(&self.service, key).map_err(|e| secret_error("mở kho bí mật", e))?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::v1::Error::NoEntry) => Ok(()),
            Err(error) => Err(secret_error("xoá token", error)),
        }
    }
}

fn secret_error(action: &str, error: keyring::v1::Error) -> AppError {
    AppError::Auth(format!("Không {action} trong kho bí mật của hệ điều hành: {error}"))
}

/// Kho trong bộ nhớ — test không được đụng Keychain thật.
#[derive(Default)]
pub struct MemoryStore {
    items: Mutex<BTreeMap<String, String>>,
}

impl SecretStore for MemoryStore {
    fn get(&self, key: &str) -> Result<Option<String>> {
        Ok(self.items.lock().unwrap_or_else(|p| p.into_inner()).get(key).cloned())
    }

    fn set(&self, key: &str, secret: &str) -> Result<()> {
        self.items.lock().unwrap_or_else(|p| p.into_inner()).insert(key.to_string(), secret.to_string());
        Ok(())
    }

    fn delete(&self, key: &str) -> Result<()> {
        self.items.lock().unwrap_or_else(|p| p.into_inner()).remove(key);
        Ok(())
    }
}

/// Máy chủ đã biết. Host lạ (GitLab tự host…) phải khai báo `provider` rõ ràng.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Github,
    Gitlab,
    Bitbucket,
}

impl Provider {
    pub fn all() -> [Provider; 3] {
        [Provider::Github, Provider::Gitlab, Provider::Bitbucket]
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Github => "GitHub",
            Self::Gitlab => "GitLab",
            Self::Bitbucket => "Bitbucket",
        }
    }

    /// Host chính thức (dùng để gợi ý, không kiểm tra host lạ).
    pub fn default_host(self) -> &'static str {
        match self {
            Self::Github => "github.com",
            Self::Gitlab => "gitlab.com",
            Self::Bitbucket => "bitbucket.org",
        }
    }

    /// Địa chỉ API của host (GitHub Enterprise dùng `/api/v3`).
    pub fn api_base(self, host: &str) -> String {
        match self {
            Self::Github if host.eq_ignore_ascii_case("github.com") => "https://api.github.com".to_string(),
            Self::Github => format!("https://{host}/api/v3"),
            Self::Gitlab => format!("https://{host}/api/v4"),
            Self::Bitbucket => "https://api.bitbucket.org/2.0".to_string(),
        }
    }

    /// Địa chỉ giao diện để mở trên trình duyệt.
    pub fn web_base(self, host: &str) -> String {
        format!("https://{host}")
    }

    /// Host này là của provider nào (chỉ nhận host chính thức).
    pub fn for_host(host: &str) -> Option<Provider> {
        Provider::all().into_iter().find(|provider| provider.default_host().eq_ignore_ascii_case(host))
    }

    /// Bitbucket Cloud không có OAuth device flow: tài khoản chỉ thêm được bằng cách dán token.
    pub fn supports_device_flow(self) -> bool {
        matches!(self, Self::Github | Self::Gitlab)
    }

    /// Email ẩn của GitHub: commit được tính cho tài khoản mà không lộ email thật.
    pub fn noreply_email(self, host: &str, id: &str, login: &str) -> Option<String> {
        match self {
            Self::Github if host.eq_ignore_ascii_case("github.com") => Some(format!("{id}+{login}@users.noreply.github.com")),
            _ => None,
        }
    }
}

/// Một tài khoản đã đăng nhập (không chứa token trong file).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub host: String,
    pub provider: Provider,
    /// Id của tài khoản ở máy chủ (GitHub dùng để dựng email ẩn `id+login@users.noreply.github.com`).
    #[serde(default)]
    pub id: String,
    pub login: String,
    /// Tên hiển thị của máy chủ (có thể rỗng).
    pub display_name: String,
    /// Tên / email dùng cho commit (người dùng sửa được).
    pub commit_name: String,
    pub commit_email: String,
    /// Tổ chức / nhóm / workspace mà tài khoản là thành viên — để chọn token theo owner.
    #[serde(default)]
    pub organizations: Vec<String>,
    #[serde(default)]
    pub organizations_updated_at: Option<String>,
    /// Token OAuth hết hạn lúc này (giây Unix) — GitLab cấp token ~2 giờ kèm refresh token (trong kho bí mật). `None`: không
    /// hết hạn (GitHub OAuth App, token dán tay).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_expires_at: Option<u64>,
}

impl Account {
    fn key(&self) -> String {
        account_key(&self.host, &self.login)
    }
}

/// Phần lưu trong `<data>/accounts.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountsFile {
    #[serde(default)]
    pub accounts: Vec<Account>,
    /// host → login của tài khoản mặc định.
    #[serde(default)]
    pub defaults: BTreeMap<String, String>,
    /// `host/owner` → login do người dùng tự gán cho repo.
    #[serde(default)]
    pub owner_assignments: BTreeMap<String, String>,
    /// host → Client ID của OAuth App (device flow); rỗng = chỉ dán token.
    #[serde(default)]
    pub oauth_client_ids: BTreeMap<String, String>,
}

/// Đăng nhập bằng mã (device flow) đang chờ người dùng xác nhận. Webview giữ `device_code` để hỏi, Rust giữ nhịp hỏi.
#[derive(Debug, Clone)]
pub struct Login {
    pub host: String,
    pub provider: Provider,
    pub client_id: String,
    pub device_code: String,
    pub expires_at: Instant,
    /// Khoảng chờ tối thiểu giữa hai lần hỏi; `slow_down` của RFC 8628 cộng thêm 5 giây.
    pub interval: Duration,
    /// Chưa tới lúc này thì không hỏi máy chủ (webview hỏi dồn cũng không bị máy chủ chặn).
    pub next_poll_at: Instant,
}

/// Client ID của OAuth App dựng sẵn lúc build (`THAIGIT_GITHUB_CLIENT_ID`, `THAIGIT_GITLAB_CLIENT_ID`): Client ID của public
/// client không phải bí mật. Người dùng vẫn ghi đè được trong Cài đặt (GitHub Enterprise, GitLab tự host…).
/// GitHub có sẵn Client ID của OAuth App "Thaigit" (bật Device Flow, token không hết hạn) — giống `Resources/Info.plist`.
const GITHUB_CLIENT_ID: &str = "Ov23li9UeeQjJJwQqLqH";

fn builtin_client_id(host: &str) -> Option<&'static str> {
    let value = match host {
        "github.com" => option_env!("THAIGIT_GITHUB_CLIENT_ID").or(Some(GITHUB_CLIENT_ID)),
        "gitlab.com" => option_env!("THAIGIT_GITLAB_CLIENT_ID"),
        _ => None,
    };
    value.map(str::trim).filter(|id| !id.is_empty())
}

/// Số phiên đăng nhập được giữ đồng thời (mỗi cửa sổ một phiên).
const MAX_LOGINS: usize = 8;

impl Accounts {
    /// Bắt đầu đăng nhập bằng mã: cần Client ID của OAuth App trên máy chủ đó.
    pub async fn start_login(
        &self,
        host: &str,
        provider: Option<Provider>,
        client_id: Option<&str>,
    ) -> Result<crate::forge::DeviceCode> {
        let provider = provider_for(host, provider)?;
        let host = host.to_ascii_lowercase();
        let client_id = match client_id.map(str::trim).filter(|id| !id.is_empty()) {
            Some(client_id) => client_id.to_string(),
            None => self.oauth_client_id(&host).unwrap_or_default(),
        };
        if !provider.supports_device_flow() {
            return Err(AppError::Auth(format!("{} không có đăng nhập bằng mã — hãy dán token", provider.label())));
        }
        if !safe_secret(&client_id, 200) {
            return Err(AppError::Auth(format!(
                "{} chưa có Client ID của OAuth App — dán token, hoặc người duy trì điền Client ID rồi đăng nhập bằng mã",
                provider.label()
            )));
        }
        let code = crate::forge::request_device_code(&host, provider, &client_id).await?;
        let now = Instant::now();
        let interval = clamp_interval(Duration::from_secs(u64::from(code.interval)));
        let mut logins = self.lock_logins();
        logins.retain(|login| login.expires_at > now);
        if logins.len() >= MAX_LOGINS {
            return Err(AppError::Busy("Có quá nhiều cửa sổ đang đăng nhập — đóng hộp thoại rồi thử lại".into()));
        }
        logins.push(Login {
            host,
            provider,
            client_id,
            device_code: code.device_code.clone(),
            expires_at: now + Duration::from_secs(u64::from(code.expires_in.max(60))),
            interval,
            next_poll_at: now + interval,
        });
        Ok(code)
    }

    /// Hỏi token cho phiên đăng nhập của `device_code` (một lần, không chờ). `Ok(None)` = người dùng chưa xác nhận, hoặc
    /// chưa tới nhịp hỏi tiếp theo; `Ok(Some(login))` = đã lưu tài khoản. Lỗi (từ chối, hết hạn…) thì phiên bị bỏ.
    pub async fn poll_login(&self, device_code: &str) -> Result<Option<String>> {
        let login = {
            let mut logins = self.lock_logins();
            let now = Instant::now();
            logins.retain(|login| login.expires_at > now);
            let login = logins.iter_mut().find(|login| login.device_code == device_code).ok_or_else(|| {
                AppError::Auth("Phiên đăng nhập đã hết hạn hoặc đã đóng — bấm đăng nhập lại".into())
            })?;
            // Hỏi dồn trước `interval` sẽ bị máy chủ từ chối (RFC 8628): trả "chưa xong" mà không gọi mạng.
            if now < login.next_poll_at {
                return Ok(None);
            }
            login.next_poll_at = now + login.interval;
            login.clone()
        };
        let outcome = crate::forge::poll_for_token(&login.host, login.provider, &login.client_id, &login.device_code).await;
        match outcome {
            Ok(crate::forge::PollOutcome::Pending) => Ok(None),
            Ok(crate::forge::PollOutcome::SlowDown) => {
                if let Some(waiting) = self.lock_logins().iter_mut().find(|item| item.device_code == device_code) {
                    waiting.interval = clamp_interval(waiting.interval + Duration::from_secs(5));
                    waiting.next_poll_at = Instant::now() + waiting.interval;
                }
                Ok(None)
            }
            Ok(crate::forge::PollOutcome::Token(grant)) => {
                self.cancel_login(device_code);
                let account = self.add_token_from_api(&login.host, login.provider, &grant.access).await?;
                self.store_grant_extras(&account.host, &account.login, &grant)?;
                Ok(Some(account.login))
            }
            Err(error) => {
                self.cancel_login(device_code);
                Err(error)
            }
        }
    }

    /// Bỏ phiên đăng nhập (người dùng đóng hộp thoại) — token đang chờ không được dùng nữa.
    pub fn cancel_login(&self, device_code: &str) {
        self.lock_logins().retain(|login| login.device_code != device_code);
    }

    fn lock_logins(&self) -> std::sync::MutexGuard<'_, Vec<Login>> {
        self.logins.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Đọc danh tính + tổ chức từ API rồi lưu tài khoản (kèm token) — dùng chung cho dán token và device flow.
    pub async fn add_token_from_api(&self, host: &str, provider: Provider, token: &str) -> Result<crate::accounts::Account> {
        if !safe_secret(token, 512) {
            return Err(AppError::Auth("Token không hợp lệ".into()));
        }
        let identity = crate::forge::fetch_identity(host, provider, token).await?;
        let account = self.upsert(host, provider, &identity.id, &identity.login, &identity.display_name, token)?;
        // Tổ chức chỉ để chọn token theo owner: thiếu quyền `read:org` không làm hỏng đăng nhập.
        if let Ok(organizations) = crate::forge::fetch_organizations(host, provider, token).await {
            let _ = self.set_organizations(host, &account.login, organizations);
        }
        Ok(account)
    }

    /// Kiểm tra token rồi lưu (webview dán token).
    pub async fn add_token(&self, host: &str, provider: Option<Provider>, token: &str) -> Result<crate::accounts::Account> {
        let provider = provider_for(host, provider)?;
        let host = host.to_ascii_lowercase();
        self.add_token_from_api(&host, provider, token).await
    }
}

fn clamp_interval(wait: Duration) -> Duration {
    wait.clamp(Duration::from_secs(1), Duration::from_secs(30))
}

/// Ảnh gửi webview: không có token, chỉ có `hasToken` + lý do chọn tài khoản theo owner hiện tại.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountsView {
    pub accounts: Vec<AccountView>,
    pub defaults: BTreeMap<String, String>,
    pub owner_assignments: BTreeMap<String, String>,
    pub oauth_client_ids: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    #[serde(flatten)]
    pub account: Account,
    pub has_token: bool,
}

/// Lý do chọn tài khoản cho owner.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MatchReason {
    /// Người dùng tự gán owner cho tài khoản.
    Assigned,
    /// Owner trùng login của một tài khoản.
    Login,
    /// Owner là tổ chức mà tài khoản là thành viên.
    Organization,
    /// Không khớp: tài khoản mặc định của host.
    Fallback,
}

/// Kết quả chọn tài khoản (token đọc sau, chỉ khi thật cần dùng).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolved {
    pub host: String,
    pub login: String,
    pub reason: MatchReason,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

/// Khoá trong kho bí mật: `host/login` (login đã kiểm là chữ/số/`-_.`).
fn account_key(host: &str, login: &str) -> String {
    format!("{host}/{login}")
}

/// Owner hợp lệ (chữ, số, `-`, `_`, `.`), viết thường; `None` nếu rỗng hoặc có ký tự lạ.
pub fn normalized_owner(owner: &str) -> Option<String> {
    let trimmed = owner.trim();
    if trimmed.is_empty()
        || trimmed.len() > 100
        || !trimmed.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
    {
        return None;
    }
    Some(trimmed.to_ascii_lowercase())
}

/// Login / token hợp lệ: không rỗng, không ký tự điều khiển hay khoảng trắng (giao thức credential của git là từng dòng
/// `key=value` — xuống dòng sẽ chèn được dòng lạ).
pub fn safe_secret(value: &str, max_len: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_len
        && !value.chars().any(|c| c.is_control() || c == ' ' || c == '\t')
}

/// Host hợp lệ: tên miền không scheme, không đường dẫn, không `@`.
pub fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host.contains('.')
        && host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.'))
        && !host.starts_with('.')
        && !host.ends_with('.')
}

/// Provider của host: host chính thức thì tự nhận; host lạ phải truyền `provider`.
pub fn provider_for(host: &str, requested: Option<Provider>) -> Result<Provider> {
    if !valid_host(host) {
        return Err(AppError::Auth(format!("Host không hợp lệ: {host}")));
    }
    match Provider::for_host(host) {
        Some(provider) => match requested {
            Some(other) if other != provider => Err(AppError::Auth(format!(
                "{host} là máy chủ {}, không phải {}",
                provider.label(),
                other.label()
            ))),
            _ => Ok(provider),
        },
        None => requested.ok_or_else(|| {
            AppError::Auth(format!("Chưa biết máy chủ nào ở host {host} — hãy chọn GitHub, GitLab hay Bitbucket"))
        }),
    }
}

pub struct Accounts {
    path: PathBuf,
    secrets: Arc<dyn SecretStore>,
    file: Mutex<AccountsFile>,
    /// Phiên đăng nhập bằng mã đang chờ (chỉ trong RAM, không lưu đĩa).
    logins: Mutex<Vec<Login>>,
}

impl Accounts {
    /// Nạp từ `<data>/accounts.json`; file hỏng thì bắt đầu lại từ rỗng (không mất khoá vì token nằm ngoài file).
    pub fn load(data_dir: &Path, secrets: Arc<dyn SecretStore>) -> Arc<Self> {
        let path = data_dir.join("accounts.json");
        let file = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<AccountsFile>(&bytes).ok())
            .unwrap_or_default();
        Arc::new(Self { path, secrets, file: Mutex::new(file), logins: Mutex::default() })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, AccountsFile> {
        self.file.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn save(&self, file: &AccountsFile) -> Result<()> {
        crate::store::write_json(&self.path, file)
    }

    fn commit(&self, file: &AccountsFile) -> Result<()> {
        self.save(file)?;
        *self.lock() = file.clone();
        Ok(())
    }

    /// Tài khoản của host (không phân biệt hoa thường).
    fn find<'a>(file: &'a AccountsFile, host: &str, login: &str) -> Option<&'a Account> {
        file.accounts.iter().find(|a| a.host.eq_ignore_ascii_case(host) && a.login.eq_ignore_ascii_case(login))
    }

    fn index_of(file: &AccountsFile, host: &str, login: &str) -> Option<usize> {
        file.accounts.iter().position(|a| a.host.eq_ignore_ascii_case(host) && a.login.eq_ignore_ascii_case(login))
    }

    /// Tài khoản mặc định của host: theo `defaults`, không có thì tài khoản đầu tiên của host đó.
    fn default_account<'a>(file: &'a AccountsFile, host: &str) -> Option<&'a Account> {
        let of_host = || file.accounts.iter().find(|a| a.host.eq_ignore_ascii_case(host));
        file.defaults
            .get(&host.to_ascii_lowercase())
            .and_then(|login| file.accounts.iter().find(|a| a.host.eq_ignore_ascii_case(host) && a.login.eq_ignore_ascii_case(login)))
            .or_else(of_host)
    }

    fn has_token(&self, account: &Account) -> bool {
        self.secrets.get(&account.key()).ok().flatten().is_some()
    }

    /// Ảnh gửi webview: `defaults` là tài khoản mặc định HIỆU LỰC của từng host (lựa chọn của người dùng, không có thì
    /// tài khoản đầu tiên của host đó).
    pub fn view(&self) -> AccountsView {
        let file = self.lock();
        let mut defaults: BTreeMap<String, String> = BTreeMap::new();
        for (host, _) in self.hosts_in(&file) {
            if let Some(account) = Self::default_account(&file, &host) {
                defaults.insert(host, account.login.clone());
            }
        }
        AccountsView {
            accounts: file
                .accounts
                .iter()
                .map(|account| AccountView { account: account.clone(), has_token: self.has_token(account) })
                .collect(),
            defaults,
            owner_assignments: file.owner_assignments.clone(),
            oauth_client_ids: effective_client_ids(&file.oauth_client_ids),
        }
    }

    /// Token của một tài khoản (dùng cho API của máy chủ).
    pub fn token(&self, host: &str, login: &str) -> Option<String> {
        let key = {
            let file = self.lock();
            Self::find(&file, host, login)?.key()
        };
        self.secrets.get(&key).ok().flatten().filter(|token| safe_secret(token, 512))
    }

    /// Có tài khoản nào của host này đã có token không (để biết có cần chèn credential helper vào lệnh git).
    pub fn host_has_token(&self, host: &str) -> bool {
        let file = self.lock();
        file.accounts.iter().filter(|a| a.host.eq_ignore_ascii_case(host)).any(|a| self.has_token(a))
    }

    /// Thêm (hoặc cập nhật) tài khoản + lưu token. Login đổi hoa/thường thì owner đã gán và tài khoản mặc định đi theo.
    pub fn upsert(
        &self,
        host: &str,
        provider: Provider,
        id: &str,
        login: &str,
        display_name: &str,
        token: &str,
    ) -> Result<Account> {
        if !safe_secret(login, 100) {
            return Err(AppError::Auth("Tên đăng nhập không hợp lệ".into()));
        }
        if !safe_secret(token, 512) {
            return Err(AppError::Auth("Token không hợp lệ".into()));
        }
        let mut file = self.lock().clone();
        let host = host.to_ascii_lowercase();
        let account = match Self::index_of(&file, &host, login) {
            Some(index) => {
                let old_login = file.accounts[index].login.clone();
                let account = &mut file.accounts[index];
                account.display_name = display_name.to_string();
                account.provider = provider;
                if !id.is_empty() {
                    account.id = id.to_string();
                }
                if old_login != login {
                    if !old_login.eq_ignore_ascii_case(login) {
                        self.secrets.delete(&account_key(&host, &old_login))?;
                        for assigned in file.owner_assignments.values_mut() {
                            if assigned.eq_ignore_ascii_case(&old_login) {
                                *assigned = login.to_string();
                            }
                        }
                        if file.defaults.get(&host).is_some_and(|value| value.eq_ignore_ascii_case(&old_login)) {
                            file.defaults.insert(host.clone(), login.to_string());
                        }
                    }
                    account.login = login.to_string();
                }
                account.clone()
            }
            None => {
                let login_owned = login.to_string();
                let account = Account {
                    host: host.clone(),
                    provider,
                    id: id.to_string(),
                    login: login_owned.clone(),
                    display_name: display_name.to_string(),
                    commit_name: display_name.to_string(),
                    commit_email: provider
                        .noreply_email(&host, id, &login_owned)
                        .unwrap_or_else(|| format!("{login_owned}@users.noreply.thaigit")),
                    organizations: Vec::new(),
                    organizations_updated_at: None,
                    token_expires_at: None,
                };
                file.accounts.push(account.clone());
                account
            }
        };
        self.secrets.set(&account_key(&host, login), token)?;
        // Token mới (dán tay hoặc vừa đăng nhập): bỏ refresh token / hạn cũ — device flow đặt lại ngay sau đó nếu có.
        self.secrets.delete(&refresh_key(&host, login))?;
        if let Some(index) = Self::index_of(&file, &host, login) {
            file.accounts[index].token_expires_at = None;
        }
        self.commit(&file)?;
        Ok(Self::find(&file, &host, login).cloned().unwrap_or(account))
    }

    /// Lưu refresh token + hạn của token OAuth vừa cấp.
    fn store_grant_extras(&self, host: &str, login: &str, grant: &crate::forge::TokenGrant) -> Result<()> {
        let Some(refresh) = grant.refresh.as_deref().filter(|token| safe_secret(token, 512)) else { return Ok(()) };
        self.secrets.set(&refresh_key(host, login), refresh)?;
        let mut file = self.lock().clone();
        if let Some(index) = Self::index_of(&file, host, login) {
            file.accounts[index].token_expires_at = grant.expires_in.map(|seconds| unix_now() + seconds);
            self.commit(&file)?;
        }
        Ok(())
    }

    /// Làm mới token OAuth của các tài khoản trên `host` sắp hết hạn (còn dưới 2 phút). Lỗi thì giữ nguyên — lệnh git / API
    /// sẽ báo đăng nhập lại như cũ.
    pub async fn refresh_due(&self, host: &str) {
        let due: Vec<Account> = {
            let file = self.lock();
            file.accounts
                .iter()
                .filter(|a| a.host.eq_ignore_ascii_case(host) && a.token_expires_at.is_some_and(|at| at <= unix_now() + 120))
                .cloned()
                .collect()
        };
        for account in due {
            let Some(refresh) = self.secrets.get(&refresh_key(&account.host, &account.login)).ok().flatten() else { continue };
            let Some(client_id) = self.oauth_client_id(&account.host) else { continue };
            let Ok(grant) = crate::forge::refresh_token(&account.host, account.provider, &client_id, &refresh).await else { continue };
            if !safe_secret(&grant.access, 512) || self.secrets.set(&account.key(), &grant.access).is_err() {
                continue;
            }
            let _ = self.store_grant_extras(&account.host, &account.login, &grant);
        }
    }

    /// Cập nhật danh sách tổ chức (chọn token theo owner tổ chức).
    pub fn set_organizations(&self, host: &str, login: &str, organizations: Vec<String>) -> Result<()> {
        let mut file = self.lock().clone();
        let Some(index) = Self::index_of(&file, host, login) else { return Ok(()) };
        let mut seen: Vec<String> = Vec::new();
        for organization in organizations {
            if let Some(normalized) = normalized_owner(&organization)
                && !seen.contains(&normalized)
            {
                seen.push(normalized);
            }
        }
        file.accounts[index].organizations = seen;
        file.accounts[index].organizations_updated_at = Some(now_rfc3339());
        self.commit(&file)
    }

    pub fn set_default(&self, host: &str, login: &str) -> Result<()> {
        let mut file = self.lock().clone();
        if Self::find(&file, host, login).is_none() {
            return Err(AppError::NotFound(format!("Không có tài khoản {login} trên {host}")));
        }
        file.defaults.insert(host.to_ascii_lowercase(), file
            .accounts
            .iter()
            .find(|a| a.host.eq_ignore_ascii_case(host) && a.login.eq_ignore_ascii_case(login))
            .map(|a| a.login.clone())
            .unwrap_or_else(|| login.to_string()));
        self.commit(&file)
    }

    pub fn remove(&self, host: &str, login: &str) -> Result<()> {
        let mut file = self.lock().clone();
        let Some(index) = Self::index_of(&file, host, login) else { return Ok(()) };
        let account = file.accounts.remove(index);
        self.secrets.delete(&account.key())?;
        self.secrets.delete(&refresh_key(&account.host, &account.login))?;
        file.owner_assignments.retain(|_, assigned| !assigned.eq_ignore_ascii_case(&account.login));
        let host_key = account.host.to_ascii_lowercase();
        if file.defaults.get(&host_key).is_some_and(|value| value.eq_ignore_ascii_case(&account.login)) {
            file.defaults.remove(&host_key);
            if let Some(next) = Self::default_account(&file, &account.host) {
                file.defaults.insert(host_key, next.login.clone());
            }
        }
        self.commit(&file)
    }

    /// Gán owner cho tài khoản (`login = None`: bỏ gán). Owner lạ thì bỏ qua.
    pub fn assign_owner(&self, host: &str, owner: &str, login: Option<&str>) -> Result<()> {
        let Some(key) = normalized_owner(owner) else { return Err(AppError::policy("owner không hợp lệ")) };
        let mut file = self.lock().clone();
        let assignment_key = format!("{}/{}", host.to_ascii_lowercase(), key);
        match login {
            Some(login) if Self::find(&file, host, login).is_some() => {
                file.owner_assignments.insert(assignment_key, login.to_string());
            }
            Some(login) => return Err(AppError::NotFound(format!("Không có tài khoản {login} trên {host}"))),
            None => {
                file.owner_assignments.remove(&assignment_key);
            }
        }
        self.commit(&file)
    }

    /// Gán tài khoản cho owner khi người dùng chọn repo trong danh sách (để clone/fetch dùng đúng tài khoản).
    pub fn assign_owner_for_login(&self, host: &str, owner: &str, login: &str) -> Result<bool> {
        let current = self.resolve_login(host, Some(owner));
        if current.as_deref().is_some_and(|current| current.eq_ignore_ascii_case(login)) {
            return Ok(false);
        }
        self.assign_owner(host, owner, Some(login))?;
        Ok(true)
    }

    pub fn set_commit_identity(&self, host: &str, login: &str, name: &str, email: &str) -> Result<()> {
        let mut file = self.lock().clone();
        let Some(index) = Self::index_of(&file, host, login) else {
            return Err(AppError::NotFound(format!("Không có tài khoản {login} trên {host}")));
        };
        let name = name.trim();
        let email = email.trim();
        file.accounts[index].commit_name = if name.is_empty() {
            file.accounts[index].display_name.clone()
        } else {
            name.to_string()
        };
        file.accounts[index].commit_email = if email.is_empty() {
            let account = file.accounts[index].clone();
            account
                .provider
                .noreply_email(host, &account.id, &account.login)
                .unwrap_or_else(|| format!("{}@users.noreply.thaigit", account.login))
        } else {
            email.to_string()
        };
        self.commit(&file)
    }

    /// Lưu Client ID của OAuth App (device flow). Rỗng = xoá (quay về Client ID dựng sẵn nếu có).
    pub fn set_oauth_client_id(&self, host: &str, client_id: &str) -> Result<()> {
        if !valid_host(host) {
            return Err(AppError::Auth(format!("Host không hợp lệ: {host}")));
        }
        let mut file = self.lock().clone();
        let trimmed = client_id.trim();
        if !trimmed.is_empty() && !safe_secret(trimmed, 200) {
            return Err(AppError::Auth("Client ID không hợp lệ".into()));
        }
        let key = host.to_ascii_lowercase();
        if trimmed.is_empty() {
            file.oauth_client_ids.remove(&key);
        } else {
            file.oauth_client_ids.insert(key, trimmed.to_string());
        }
        self.commit(&file)
    }

    /// Client ID hiệu lực của host: người dùng tự điền, không có thì Client ID dựng sẵn lúc build.
    pub fn oauth_client_id(&self, host: &str) -> Option<String> {
        let host = host.to_ascii_lowercase();
        self.lock().oauth_client_ids.get(&host).cloned().or_else(|| builtin_client_id(&host).map(str::to_string))
    }

    /// Login được chọn cho owner (chưa đọc token).
    pub fn resolve_login(&self, host: &str, owner: Option<&str>) -> Option<String> {
        let file = self.lock();
        Self::resolve_login_in(&file, host, owner)
    }

    /// Chọn tài khoản cho owner: người dùng tự gán → owner trùng login → tổ chức → mặc định của host.
    fn resolve_in(file: &AccountsFile, host: &str, owner: Option<&str>) -> Option<(String, MatchReason)> {
        let fallback = Self::default_account(file, host)?;
        let fallback_login = fallback.login.clone();
        let Some(key) = owner.and_then(normalized_owner) else { return Some((fallback_login, MatchReason::Fallback)) };
        let assignment = format!("{}/{}", host.to_ascii_lowercase(), key);
        if let Some(login) = file.owner_assignments.get(&assignment)
            && let Some(account) = Self::find(file, host, login)
        {
            return Some((account.login.clone(), MatchReason::Assigned));
        }
        if let Some(own) = Self::find(file, host, &key) {
            return Some((own.login.clone(), MatchReason::Login));
        }
        let mut candidates = std::iter::once(fallback)
            .chain(file.accounts.iter().filter(|a| a.host.eq_ignore_ascii_case(host) && a.login != fallback_login));
        let member = candidates.find(|account| account.organizations.iter().any(|organization| organization == &key));
        Some(match member {
            Some(account) => (account.login.clone(), MatchReason::Organization),
            None => (fallback_login, MatchReason::Fallback),
        })
    }

    fn resolve_login_in(file: &AccountsFile, host: &str, owner: Option<&str>) -> Option<String> {
        Self::resolve_in(file, host, owner).map(|(login, _)| login)
    }

    /// Lý do chọn tài khoản cho owner (để UI giải thích).
    pub fn resolve_reason(&self, host: &str, owner: Option<&str>) -> MatchReason {
        let file = self.lock();
        Self::resolve_in(&file, host, owner).map(|(_, reason)| reason).unwrap_or(MatchReason::Fallback)
    }

    /// Tài khoản + token cho owner. Owner nào không có tài khoản được gán token thì KHÔNG rơi về tài khoản khác:
    /// lệnh git tới owner đó không có token, git báo lỗi xác thực và UI gợi ý đăng nhập đúng tài khoản ấy.
    pub fn resolve(&self, host: &str, owner: Option<&str>) -> Option<Resolved> {
        let (login, reason) = {
            let file = self.lock();
            Self::resolve_in(&file, host, owner)?
        };
        let token = self.token(host, &login);
        Some(Resolved { host: host.to_string(), login, reason, token })
    }

    /// Provider của host đã có tài khoản (lỗi nếu chưa có tài khoản nào).
    pub fn provider_of(&self, host: &str) -> Result<Provider> {
        let file = self.lock();
        file.accounts
            .iter()
            .find(|account| account.host.eq_ignore_ascii_case(host))
            .map(|account| account.provider)
            .ok_or_else(|| AppError::NotFound(format!("Chưa có tài khoản nào trên {host}")))
    }

    /// Danh sách host đã có tài khoản (một lần cho mỗi host) — dùng khi chèn credential helper.
    pub fn hosts(&self) -> Vec<(String, Provider)> {
        self.hosts_in(&self.lock())
    }

    fn hosts_in(&self, file: &AccountsFile) -> Vec<(String, Provider)> {
        let mut hosts: Vec<(String, Provider)> = Vec::new();
        for account in &file.accounts {
            if !hosts.iter().any(|(host, _)| host.eq_ignore_ascii_case(&account.host)) {
                hosts.push((account.host.clone(), account.provider));
            }
        }
        hosts
    }
}

/// Client ID người dùng điền, cộng Client ID dựng sẵn của host chưa được điền.
fn effective_client_ids(saved: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    let mut ids = saved.clone();
    for host in ["github.com", "gitlab.com"] {
        if let Some(id) = builtin_client_id(host) {
            ids.entry(host.to_string()).or_insert_with(|| id.to_string());
        }
    }
    ids
}

fn unix_now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Khoá của refresh token trong kho bí mật (cạnh token của tài khoản).
fn refresh_key(host: &str, login: &str) -> String {
    format!("{}#refresh", account_key(host, login))
}

pub(crate) fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

/// Một remote mà ta biết: host, owner và tên repo (từ URL của `git remote` hoặc URL người dùng dán).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteTarget {
    pub host: String,
    pub provider: Option<Provider>,
    /// Đường dẫn sau domain, bỏ `.git` (vd. `hoangthai18/thaigit`, `group/sub/repo`).
    pub path: String,
    /// Phần đầu của đường dẫn (user / tổ chức) — dùng để chọn token.
    pub owner: String,
    pub name: String,
    /// Remote dùng HTTPS (mới đi qua credential của app; SSH dùng khoá SSH của người dùng).
    pub https: bool,
    /// Username trong URL (`https://alice@github.com/…`).
    pub username: Option<String>,
}

/// Đọc host / owner / tên từ URL remote (https, ssh, dạng scp của ssh). `None` nếu không đọc được.
pub fn parse_remote(url: &str) -> Option<RemoteTarget> {
    let text = url.trim();
    if text.is_empty() {
        return None;
    }
    if text.contains(|c: char| c.is_control() || c == ' ') {
        return None;
    }
    let (host, path, https, username) = if let Some(rest) = text.strip_prefix("https://").or_else(|| text.strip_prefix("http://")) {
        let https = text.starts_with("https://");
        let (authority, path) = rest.split_once('/')?;
        let (user, host) = match authority.rsplit_once('@') {
            Some((user, host)) => (Some(user.to_string()), host),
            None => (None, authority),
        };
        let host = host.split(':').next().unwrap_or(host);
        (host.to_ascii_lowercase(), path, https, user)
    } else if let Some(rest) = text.strip_prefix("ssh://") {
        let (authority, path) = rest.split_once('/')?;
        let host = authority.rsplit_once('@').map(|(_, host)| host).unwrap_or(authority);
        let host = host.split(':').next().unwrap_or(host);
        (host.to_ascii_lowercase(), path, false, None)
    } else if let Some((host, path)) = text.split_once(':') {
        // Dạng scp của ssh: git@github.com:owner/repo.git
        if !host.contains('/') && !host.contains('.') {
            return None;
        }
        (host.rsplit_once('@').map(|(_, host)| host).unwrap_or(host).to_ascii_lowercase(), path, false, None)
    } else {
        return None;
    };
    if !valid_host(&host) {
        return None;
    }
    let path = path.trim_end_matches('/').trim_end_matches(".git");
    let mut segments = path.split('/').filter(|segment| !segment.is_empty());
    let name = segments.next_back()?.to_string();
    let owner = segments.next()?.to_string();
    if segments.next().is_none() && normalized_owner(&owner).is_none() {
        return None;
    }
    Some(RemoteTarget { host: host.clone(), provider: Provider::for_host(&host), path: path.to_string(), owner, name, https, username })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn accounts() -> (tempfile::TempDir, Arc<Accounts>) {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(MemoryStore::default());
        let accounts = Accounts::load(dir.path(), store);
        (dir, accounts)
    }

    fn add(accounts: &Accounts, host: &str, provider: Provider, login: &str) {
        accounts.upsert(host, provider, "42", login, login, &format!("token-{login}")).unwrap();
    }

    #[test]
    fn oauth_refresh_token_is_kept_secret_and_cleared_with_the_account() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(MemoryStore::default());
        let accounts = Accounts::load(dir.path(), store.clone());
        add(&accounts, "gitlab.com", Provider::Gitlab, "carol");
        let grant = crate::forge::TokenGrant { access: "at".into(), refresh: Some("rt-bi-mat".into()), expires_in: Some(7200) };
        accounts.store_grant_extras("gitlab.com", "carol", &grant).unwrap();
        let text = std::fs::read_to_string(dir.path().join("accounts.json")).unwrap();
        assert!(!text.contains("rt-bi-mat"), "refresh token không được ghi ra đĩa: {text}");
        assert_eq!(store.get(&refresh_key("gitlab.com", "carol")).unwrap().as_deref(), Some("rt-bi-mat"));
        let expires = accounts.lock().accounts[0].token_expires_at.unwrap();
        assert!(expires > unix_now() + 7000 && expires <= unix_now() + 7200);
        assert!(!format!("{grant:?}").contains("rt-bi-mat"));

        // Dán token mới thay cho token OAuth: không còn hạn / refresh token cũ.
        add(&accounts, "gitlab.com", Provider::Gitlab, "carol");
        assert_eq!(accounts.lock().accounts[0].token_expires_at, None);
        assert!(store.get(&refresh_key("gitlab.com", "carol")).unwrap().is_none());

        accounts.store_grant_extras("gitlab.com", "carol", &grant).unwrap();
        accounts.remove("gitlab.com", "carol").unwrap();
        assert!(store.get(&refresh_key("gitlab.com", "carol")).unwrap().is_none());
    }

    #[test]
    fn token_never_lands_in_the_json_file() {
        let (dir, accounts) = accounts();
        add(&accounts, "github.com", Provider::Github, "alice");
        let text = std::fs::read_to_string(dir.path().join("accounts.json")).unwrap();
        assert!(!text.contains("token-alice"), "token không được ghi ra đĩa: {text}");
        assert_eq!(accounts.token("github.com", "alice").as_deref(), Some("token-alice"));
    }

    #[test]
    fn resolve_prefers_assignment_then_login_then_org_then_default() {
        let (_dir, accounts) = accounts();
        add(&accounts, "github.com", Provider::Github, "alice");
        add(&accounts, "github.com", Provider::Github, "bob");
        accounts.set_organizations("github.com", "bob", vec!["Acme".into()]).unwrap();

        assert_eq!(accounts.resolve_login("github.com", Some("acme")).as_deref(), Some("bob"));
        assert_eq!(accounts.resolve_login("github.com", Some("alice")).as_deref(), Some("alice"));
        assert_eq!(accounts.resolve_login("github.com", Some("other")).as_deref(), Some("alice"));

        accounts.assign_owner("github.com", "acme", Some("alice")).unwrap();
        assert_eq!(accounts.resolve_login("github.com", Some("acme")).as_deref(), Some("alice"));
        assert_eq!(accounts.resolve_reason("github.com", Some("acme")), MatchReason::Assigned);

        accounts.assign_owner("github.com", "acme", None).unwrap();
        assert_eq!(accounts.resolve_reason("github.com", Some("acme")), MatchReason::Organization);
        assert_eq!(accounts.resolve_reason("github.com", Some("nobody")), MatchReason::Fallback);
    }

    #[test]
    fn assignment_survives_a_relogin_with_a_different_case() {
        let (_dir, accounts) = accounts();
        add(&accounts, "github.com", Provider::Github, "Alice");
        accounts.assign_owner("github.com", "acme", Some("Alice")).unwrap();
        accounts.upsert("github.com", Provider::Github, "42", "alice", "Alice", "token-2").unwrap();
        // Một tài khoản, tìm theo cả hai cách viết; token cũ đã bị xoá khỏi kho bí mật.
        assert_eq!(accounts.token("github.com", "alice").as_deref(), Some("token-2"));
        assert_eq!(accounts.token("github.com", "Alice").as_deref(), Some("token-2"));
        assert_eq!(accounts.view().accounts.len(), 1);
        assert_eq!(accounts.resolve_login("github.com", Some("acme")).as_deref(), Some("alice"));
    }

    #[test]
    fn each_host_keeps_its_own_default_and_owners_do_not_collide() {
        let (_dir, accounts) = accounts();
        add(&accounts, "github.com", Provider::Github, "alice");
        add(&accounts, "gitlab.com", Provider::Gitlab, "bob");
        accounts.assign_owner("github.com", "acme", Some("alice")).unwrap();
        assert_eq!(accounts.resolve_login("gitlab.com", Some("acme")).as_deref(), Some("bob"));
        assert_eq!(accounts.view().defaults.get("github.com").map(String::as_str), Some("alice"));
        assert_eq!(accounts.view().defaults.get("gitlab.com").map(String::as_str), Some("bob"));
    }

    #[test]
    fn remove_clears_token_assignment_and_default() {
        let (_dir, accounts) = accounts();
        add(&accounts, "github.com", Provider::Github, "alice");
        add(&accounts, "github.com", Provider::Github, "bob");
        accounts.assign_owner("github.com", "acme", Some("bob")).unwrap();
        accounts.remove("github.com", "bob").unwrap();
        assert_eq!(accounts.token("github.com", "bob"), None);
        assert_eq!(accounts.resolve_login("github.com", Some("acme")).as_deref(), Some("alice"));
        assert!(accounts.view().owner_assignments.is_empty());
    }

    #[test]
    fn unknown_host_needs_an_explicit_provider() {
        assert!(provider_for("gitlab.example.com", None).is_err());
        assert_eq!(provider_for("gitlab.example.com", Some(Provider::Gitlab)).unwrap(), Provider::Gitlab);
        assert!(provider_for("github.com", Some(Provider::Gitlab)).is_err());
        assert!(provider_for("https://github.com", None).is_err());
    }

    #[test]
    fn remote_urls_are_parsed_for_known_hosts() {
        let https = parse_remote("https://github.com/HoangThai18/thaigit.git").unwrap();
        assert_eq!(https.host, "github.com");
        assert_eq!(https.owner, "HoangThai18");
        assert_eq!(https.name, "thaigit");
        assert_eq!(https.provider, Some(Provider::Github));
        assert!(https.https);

        let scp = parse_remote("git@github.com:HoangThai18/thaigit.git").unwrap();
        assert_eq!(scp.owner, "HoangThai18");
        assert!(!scp.https);

        let with_user = parse_remote("https://alice@github.com/owner/repo").unwrap();
        assert_eq!(with_user.username.as_deref(), Some("alice"));

        let nested = parse_remote("https://gitlab.com/group/sub/repo.git").unwrap();
        assert_eq!(nested.owner, "group");
        assert_eq!(nested.name, "repo");
        assert_eq!(nested.path, "group/sub/repo");

        assert!(parse_remote("git@gitlab.com:only-group.git").is_none());
        assert!(parse_remote("không phải url").is_none());
        assert!(parse_remote("https://").is_none());
    }

    #[test]
    fn client_id_can_be_cleared_and_must_be_one_line() {
        let (_dir, accounts) = accounts();
        accounts.set_oauth_client_id("git.acme.vn", " Iv1.abc ").unwrap();
        assert_eq!(accounts.oauth_client_id("GIT.acme.vn").as_deref(), Some("Iv1.abc"));
        assert!(accounts.set_oauth_client_id("git.acme.vn", "a\nb").is_err());
        accounts.set_oauth_client_id("git.acme.vn", "  ").unwrap();
        assert_eq!(accounts.oauth_client_id("git.acme.vn"), None);
        assert!(accounts.set_oauth_client_id("https://x", "id").is_err());
    }

    fn pending_login(accounts: &Accounts, device_code: &str, next_poll_at: Instant) {
        accounts.lock_logins().push(Login {
            host: "github.com".into(),
            provider: Provider::Github,
            client_id: "id".into(),
            device_code: device_code.into(),
            expires_at: Instant::now() + Duration::from_secs(600),
            interval: Duration::from_secs(5),
            next_poll_at,
        });
    }

    #[tokio::test]
    async fn polling_too_early_keeps_the_login_without_calling_the_server() {
        let (_dir, accounts) = accounts();
        pending_login(&accounts, "dc-1", Instant::now() + Duration::from_secs(60));
        // Chưa tới nhịp: trả "chưa xong" (không gọi mạng) và phiên vẫn còn cho lần hỏi sau.
        assert_eq!(accounts.poll_login("dc-1").await.unwrap(), None);
        assert_eq!(accounts.poll_login("dc-1").await.unwrap(), None);
        assert_eq!(accounts.lock_logins().len(), 1);
        accounts.cancel_login("dc-1");
        assert_eq!(accounts.poll_login("dc-1").await.unwrap_err().code(), "auth");
    }

    #[tokio::test]
    async fn expired_logins_are_dropped() {
        let (_dir, accounts) = accounts();
        pending_login(&accounts, "dc-2", Instant::now());
        accounts.lock_logins()[0].expires_at = Instant::now();
        assert_eq!(accounts.poll_login("dc-2").await.unwrap_err().code(), "auth");
        assert!(accounts.lock_logins().is_empty());
    }

    #[test]
    fn secrets_with_control_characters_are_rejected() {
        assert!(!safe_secret("a b", 100));
        assert!(!safe_secret("a\nb", 100));
        assert!(!safe_secret("", 100));
        assert!(safe_secret("ghp_abcDEF123", 100));
    }
}