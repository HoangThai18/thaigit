//! Git accounts on known hosts (GitHub / GitLab / Bitbucket): the NON-secret part lives in
//! `<data>/accounts.json`, tokens live in the OS keystore (Keychain / Credential Manager).
//!
//! Several accounts per host (a personal repo plus a company repo): `resolve(host, owner)` picks a token in this
//! order — the user's own assignment → an owner matching the login → an organisation the account belongs to → that
//! host's default account. `credential.rs` uses this result to answer git, so a token never sits in a child process's
//! environment.
//!
//! The webview is untrusted: every value it sends (host, login, owner, token) is validated here.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::errors::{AppError, Result};

/// Secret service: the returned value is the raw token and only lives inside the Rust process.
pub trait SecretStore: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<String>>;
    fn set(&self, key: &str, secret: &str) -> Result<()>;
    fn delete(&self, key: &str) -> Result<()>;
}

/// The OS keystore. Failures here (locked keychain, denied access) surface as an `auth` error so the UI can suggest unlocking.
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

/// In-memory store — tests must never touch the real Keychain.
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

/// A known host. An unknown host (self-hosted GitLab…) must declare its `provider` explicitly.
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

    /// Canonical host (used for suggestions; unknown hosts are not validated).
    pub fn default_host(self) -> &'static str {
        match self {
            Self::Github => "github.com",
            Self::Gitlab => "gitlab.com",
            Self::Bitbucket => "bitbucket.org",
        }
    }

    /// Host's API base URL (GitHub Enterprise uses `/api/v3`).
    pub fn api_base(self, host: &str) -> String {
        match self {
            Self::Github if host.eq_ignore_ascii_case("github.com") => "https://api.github.com".to_string(),
            Self::Github => format!("https://{host}/api/v3"),
            Self::Gitlab => format!("https://{host}/api/v4"),
            Self::Bitbucket => "https://api.bitbucket.org/2.0".to_string(),
        }
    }

    /// Web URL to open in the browser.
    pub fn web_base(self, host: &str) -> String {
        format!("https://{host}")
    }

    /// Which provider this host belongs to (only canonical hosts are accepted).
    pub fn for_host(host: &str) -> Option<Provider> {
        Provider::all().into_iter().find(|provider| provider.default_host().eq_ignore_ascii_case(host))
    }

    /// Bitbucket Cloud has no OAuth device flow: an account can only be added by pasting a token.
    pub fn supports_device_flow(self) -> bool {
        matches!(self, Self::Github | Self::Gitlab)
    }

    /// GitHub's private email: commits count towards the account without exposing the real address.
    pub fn noreply_email(self, host: &str, id: &str, login: &str) -> Option<String> {
        match self {
            Self::Github if host.eq_ignore_ascii_case("github.com") => Some(format!("{id}+{login}@users.noreply.github.com")),
            _ => None,
        }
    }
}

/// A signed-in account (no token in the file).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub host: String,
    pub provider: Provider,
    /// Account id on the server (GitHub uses it to build the private address `id+login@users.noreply.github.com`).
    #[serde(default)]
    pub id: String,
    pub login: String,
    /// The server's display name (may be empty).
    pub display_name: String,
    /// Name / email used for commits (user-editable).
    pub commit_name: String,
    pub commit_email: String,
    /// Organisations / groups / workspaces the account belongs to — used to pick a token by owner.
    #[serde(default)]
    pub organizations: Vec<String>,
    #[serde(default)]
    pub organizations_updated_at: Option<String>,
    /// When the OAuth token expires (Unix seconds) — GitLab issues ~2-hour tokens with a refresh token (kept in the
    /// keystore). `None`: never expires (GitHub OAuth App, hand-pasted token).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_expires_at: Option<u64>,
}

impl Account {
    fn key(&self) -> String {
        account_key(&self.host, &self.login)
    }
}

/// What is persisted in `<data>/accounts.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountsFile {
    #[serde(default)]
    pub accounts: Vec<Account>,
    /// host → login of the default account.
    #[serde(default)]
    pub defaults: BTreeMap<String, String>,
    /// `host/owner` → login the user assigned to that repo.
    #[serde(default)]
    pub owner_assignments: BTreeMap<String, String>,
    /// host → OAuth App client id (device flow); empty = only pasted tokens work.
    #[serde(default)]
    pub oauth_client_ids: BTreeMap<String, String>,
}

/// A device-flow sign-in awaiting the user's confirmation. The webview holds `device_code` to poll with; Rust owns the polling cadence.
#[derive(Debug, Clone)]
pub struct Login {
    pub host: String,
    pub provider: Provider,
    pub client_id: String,
    pub device_code: String,
    pub expires_at: Instant,
    /// Minimum wait between polls; RFC 8628's `slow_down` adds 5 seconds on top.
    pub interval: Duration,
    /// Before this moment do not ask the server (a polling webview would not be rate-limited either).
    pub next_poll_at: Instant,
}

/// OAuth App client ids baked in at build time (`THAIGIT_GITHUB_CLIENT_ID`, `THAIGIT_GITLAB_CLIENT_ID`): the client id
/// of a public client is not a secret. Users can still override them in Settings (GitHub Enterprise, self-hosted
/// GitLab…).
/// GitHub already ships the client id of the "Thaigit" OAuth App (device flow on, non-expiring tokens).
const GITHUB_CLIENT_ID: &str = "Ov23li9UeeQjJJwQqLqH";
/// Application id of the "Thaigit" OAuth App on gitlab.com (non-confidential, device authorization grant on).
const GITLAB_CLIENT_ID: &str = "506513c86541200954d6656725fab6cc78b0b458cae231f79a72e09c9b94f66d";

fn builtin_client_id(host: &str) -> Option<&'static str> {
    let value = match host {
        "github.com" => option_env!("THAIGIT_GITHUB_CLIENT_ID").or(Some(GITHUB_CLIENT_ID)),
        "gitlab.com" => option_env!("THAIGIT_GITLAB_CLIENT_ID").or(Some(GITLAB_CLIENT_ID)),
        _ => None,
    };
    value.map(str::trim).filter(|id| !id.is_empty())
}

/// How many sign-in sessions are kept at once (one per window).
const MAX_LOGINS: usize = 8;

impl Accounts {
    /// Start a device-flow sign-in: needs the OAuth App client id of that host.
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

    /// Ask for the token of a `device_code` sign-in session (once, no waiting). `Ok(None)` = the user has not confirmed yet,
    /// or the next poll is not due; `Ok(Some(login))` = the account was stored. On an error (denied, expired…) the session
    /// is dropped.
    pub async fn poll_login(&self, device_code: &str) -> Result<Option<String>> {
        let login = {
            let mut logins = self.lock_logins();
            let now = Instant::now();
            logins.retain(|login| login.expires_at > now);
            let login = logins.iter_mut().find(|login| login.device_code == device_code).ok_or_else(|| {
                AppError::Auth("Phiên đăng nhập đã hết hạn hoặc đã đóng — bấm đăng nhập lại".into())
            })?;
            // Polling earlier than `interval` gets the request rejected (RFC 8628): return "not done" without a network call.
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

    /// Drop a sign-in session (the user closed the dialog) — a pending token must no longer be usable.
    pub fn cancel_login(&self, device_code: &str) {
        self.lock_logins().retain(|login| login.device_code != device_code);
    }

    fn lock_logins(&self) -> std::sync::MutexGuard<'_, Vec<Login>> {
        self.logins.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Read the identity + organisations from the API, then store the account (with its token) — shared by token pasting and device flow.
    pub async fn add_token_from_api(&self, host: &str, provider: Provider, token: &str) -> Result<crate::accounts::Account> {
        if !safe_secret(token, 512) {
            return Err(AppError::Auth("Token không hợp lệ".into()));
        }
        let identity = crate::forge::fetch_identity(host, provider, token).await?;
        let account = self.upsert(host, provider, &identity.id, &identity.login, &identity.display_name, token)?;
        // Organisations only pick a token by owner: a missing `read:org` scope must not break sign-in.
        if let Ok(organizations) = crate::forge::fetch_organizations(host, provider, token).await {
            let _ = self.set_organizations(host, &account.login, organizations);
        }
        Ok(account)
    }

    /// Validate the token, then store the account (webview pastes a token).
    pub async fn add_token(&self, host: &str, provider: Option<Provider>, token: &str) -> Result<crate::accounts::Account> {
        let provider = provider_for(host, provider)?;
        let host = host.to_ascii_lowercase();
        self.add_token_from_api(&host, provider, token).await
    }
}

fn clamp_interval(wait: Duration) -> Duration {
    wait.clamp(Duration::from_secs(1), Duration::from_secs(30))
}

/// What goes to the webview: no token, only `hasToken` plus why the account was picked for the current owner.
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

/// Why this account was picked for the owner.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MatchReason {
    /// The user assigned this owner to the account.
    Assigned,
    /// The owner matches an account's login.
    Login,
    /// The owner is an organisation the account belongs to.
    Organization,
    /// No match: the host's default account.
    Fallback,
}

/// Result of the account choice (the token is read afterwards, only when really needed).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolved {
    pub host: String,
    pub login: String,
    pub reason: MatchReason,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

/// Key in the keystore: `host/login` (the login is validated to letters/digits/`-_.`).
fn account_key(host: &str, login: &str) -> String {
    format!("{host}/{login}")
}

/// Valid owner (letters, digits, `-`, `_`, `.`), lowercased; `None` when empty or containing odd characters.
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

/// Valid login / token: non-empty, no control characters or whitespace (git's credential protocol is line-based
/// `key=value` — a newline would inject a bogus line).
pub fn safe_secret(value: &str, max_len: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_len
        && !value.chars().any(|c| c.is_control() || c == ' ' || c == '\t')
}

/// Valid host: a domain with no scheme, no path, no `@`.
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

/// Provider of a host: inferred for canonical hosts; an unknown host must pass `provider`.
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
    /// Device-flow sign-in sessions awaiting approval (RAM only, never written to disk).
    logins: Mutex<Vec<Login>>,
}

impl Accounts {
    /// Load from `<data>/accounts.json`; a corrupt file starts empty (no keys are lost, since tokens live outside the file).
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

    /// Accounts of a host (case-insensitive).
    fn find<'a>(file: &'a AccountsFile, host: &str, login: &str) -> Option<&'a Account> {
        file.accounts.iter().find(|a| a.host.eq_ignore_ascii_case(host) && a.login.eq_ignore_ascii_case(login))
    }

    fn index_of(file: &AccountsFile, host: &str, login: &str) -> Option<usize> {
        file.accounts.iter().position(|a| a.host.eq_ignore_ascii_case(host) && a.login.eq_ignore_ascii_case(login))
    }

    /// The host's default account: from `defaults`, or that host's first account when unset.
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

    /// What goes to the webview: `defaults` holds the account that is CURRENTLY the default per host (the user's
    /// choice, or that host's first account when unset).
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

    /// An account's token (for the host's API).
    pub fn token(&self, host: &str, login: &str) -> Option<String> {
        let key = {
            let file = self.lock();
            Self::find(&file, host, login)?.key()
        };
        self.secrets.get(&key).ok().flatten().filter(|token| safe_secret(token, 512))
    }

    /// Does any account of this host already have a token (i.e. must a credential helper be injected into git commands)?
    pub fn host_has_token(&self, host: &str) -> bool {
        let file = self.lock();
        file.accounts.iter().filter(|a| a.host.eq_ignore_ascii_case(host)).any(|a| self.has_token(a))
    }

    /// Add (or update) an account and store its token. When only the login's case changes, the owner assignments and the
    /// default account follow along.
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
        // A freshly pasted or freshly issued token drops the refresh token / expiry — device flow sets them again right after.
        self.secrets.delete(&refresh_key(&host, login))?;
        if let Some(index) = Self::index_of(&file, &host, login) {
            file.accounts[index].token_expires_at = None;
        }
        self.commit(&file)?;
        Ok(Self::find(&file, &host, login).cloned().unwrap_or(account))
    }

    /// Store the refresh token and expiry of a just-issued OAuth token.
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

    /// Refresh the OAuth token of accounts on `host` that expire within 2 minutes. On failure keep the old token — git
    /// commands and the API will report "sign in again" exactly as before.
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

    /// Refresh the organisation list (choosing a token by organisation owner).
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

    /// Assign an owner to an account (`login = None` clears it). An unknown owner is ignored.
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

    /// Assign an account to an owner when the user picks a repo from the list (so clone/fetch use the right account).
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

    /// Store an OAuth App client id (device flow). Empty = clear it (falling back to the build-time client id if there is one).
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

    /// The client id in effect for a host: the user's own entry, otherwise the build-time client id.
    pub fn oauth_client_id(&self, host: &str) -> Option<String> {
        let host = host.to_ascii_lowercase();
        self.lock().oauth_client_ids.get(&host).cloned().or_else(|| builtin_client_id(&host).map(str::to_string))
    }

    /// The login picked for an owner (the token is not read yet).
    pub fn resolve_login(&self, host: &str, owner: Option<&str>) -> Option<String> {
        let file = self.lock();
        Self::resolve_login_in(&file, host, owner)
    }

    /// Pick an account for an owner: user assignment → owner matching a login → organisation → the host's default.
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

    /// Why this account was picked for the owner (so the UI can explain it).
    pub fn resolve_reason(&self, host: &str, owner: Option<&str>) -> MatchReason {
        let file = self.lock();
        Self::resolve_in(&file, host, owner).map(|(_, reason)| reason).unwrap_or(MatchReason::Fallback)
    }

    /// The account plus its token for an owner. An owner with no assigned account NEVER falls back to another: a git
    /// command to that owner runs without a token, git reports an authentication error, and the UI suggests signing in
    /// to that very account.
    pub fn resolve(&self, host: &str, owner: Option<&str>) -> Option<Resolved> {
        let (login, reason) = {
            let file = self.lock();
            Self::resolve_in(&file, host, owner)?
        };
        let token = self.token(host, &login);
        Some(Resolved { host: host.to_string(), login, reason, token })
    }

    /// Provider of a host that has an account (an error when the host has none).
    pub fn provider_of(&self, host: &str) -> Result<Provider> {
        let file = self.lock();
        file.accounts
            .iter()
            .find(|account| account.host.eq_ignore_ascii_case(host))
            .map(|account| account.provider)
            .ok_or_else(|| AppError::NotFound(format!("Chưa có tài khoản nào trên {host}")))
    }

    /// Hosts that have an account (once per host) — used when injecting the credential helper.
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

/// The client id the user filled in, plus the build-time client id for hosts they left blank.
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

/// Keystore key of the refresh token (next to the account's token).
fn refresh_key(host: &str, login: &str) -> String {
    format!("{}#refresh", account_key(host, login))
}

pub(crate) fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

/// A remote we know: host, owner and repo name (from a `git remote` URL or one the user pasted).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteTarget {
    pub host: String,
    pub provider: Option<Provider>,
    /// Path after the domain, without `.git` (e.g. `hoangthai18/thaigit`, `group/sub/repo`).
    pub path: String,
    /// First path segment (user / organisation) — used to pick a token.
    pub owner: String,
    pub name: String,
    /// The remote uses HTTPS (only then does it go through the app's credential; SSH uses the user's own SSH keys).
    pub https: bool,
    /// Username in the URL (`https://alice@github.com/…`).
    pub username: Option<String>,
}

/// Read host / owner / name from a remote URL (https, ssh, scp-style). `None` when it cannot be read.
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
        // scp-style ssh: git@github.com:owner/repo.git
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

        // A newly pasted token replaces the OAuth token: no expiry / old refresh token.
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
        // One account, looked up under both spellings; the old token was already removed from the keystore.
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
        // Not due yet: return "not done" (no network call) and keep the session for the next poll.
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
