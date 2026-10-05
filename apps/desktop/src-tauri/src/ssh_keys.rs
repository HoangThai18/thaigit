//! Khoá SSH riêng của Thaigit (như agent của 1Password): khoá bí mật nằm trong kho bí mật của hệ điều hành (Credential
//! Manager trên Windows, Keychain trên macOS), phần không bí mật (tên, khoá công khai) trong `<data>/ssh-keys.json`.
//!
//! Lệnh git mạng chạm remote SSH thì Rust dựng một ssh-agent tạm chỉ cho lệnh đó (`SshAgent`): khoá đi thẳng từ kho bí mật
//! vào agent qua stdin của `ssh-add -`, không ghi ra file; lệnh xong (hoặc bị huỷ) thì agent bị dừng và socket bị xoá.
//! Webview không bao giờ thấy khoá bí mật — chỉ thấy khoá công khai và dấu vân tay.

use std::ffi::OsString;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::accounts::SecretStore;
use crate::errors::{AppError, Result};

/// Khoá trong agent tự hết hạn sau chừng này giây (phòng khi app bị tắt ngang lúc lệnh đang chạy).
const AGENT_KEY_LIFETIME_S: u32 = 900;
/// Credential Manager của Windows giới hạn ~2,5 KB mỗi mục: khoá dài (RSA 4096) được chia thành nhiều mục.
const SECRET_CHUNK: usize = 1800;
const MAX_PRIVATE_KEY_BYTES: usize = 32 * 1024;
const BEGIN: &str = "-----BEGIN OPENSSH PRIVATE KEY-----";
const END: &str = "-----END OPENSSH PRIVATE KEY-----";
const MAGIC: &[u8] = b"openssh-key-v1\0";

// MARK: - Định dạng khoá

/// Khoá công khai SSH (blob nhị phân theo RFC 4253).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicKey {
    pub blob: Vec<u8>,
    pub comment: String,
}

impl PublicKey {
    /// Đọc dòng "ssh-ed25519 AAAA… comment" (file .pub).
    pub fn parse_line(line: &str) -> Option<PublicKey> {
        let mut parts = line.trim().splitn(3, ' ');
        let kind = parts.next()?;
        let blob = STANDARD.decode(parts.next()?).ok()?;
        let key = PublicKey { blob, comment: parts.next().unwrap_or_default().trim().to_string() };
        (key.kind().as_deref() == Some(kind)).then_some(key)
    }

    /// Loại khoá ghi trong blob ("ssh-ed25519", "ssh-rsa"…).
    pub fn kind(&self) -> Option<String> {
        let mut reader = Reader(&self.blob);
        let name = reader.string()?;
        let text = std::str::from_utf8(name).ok()?;
        (!text.is_empty() && text.len() < 64 && text.chars().all(|c| c.is_ascii_alphanumeric() || "-@.".contains(c)))
            .then(|| text.to_string())
    }

    /// Tên ngắn cho giao diện.
    pub fn display_kind(&self) -> String {
        match self.kind().as_deref() {
            Some("ssh-ed25519") => "Ed25519".into(),
            Some("ssh-rsa") => "RSA".into(),
            Some("ssh-dss") => "DSA".into(),
            Some(other) if other.starts_with("ecdsa-") => "ECDSA".into(),
            Some(other) if other.starts_with("sk-") => "FIDO".into(),
            Some(other) => other.to_string(),
            None => "?".into(),
        }
    }

    pub fn line(&self) -> String {
        let base = format!("{} {}", self.kind().unwrap_or_else(|| "ssh".into()), STANDARD.encode(&self.blob));
        if self.comment.is_empty() { base } else { format!("{base} {}", self.comment) }
    }

    /// Dấu vân tay như `ssh-keygen -l`: "SHA256:<base64 không padding>".
    pub fn fingerprint(&self) -> String {
        format!("SHA256:{}", STANDARD_NO_PAD.encode(Sha256::digest(&self.blob)))
    }
}

struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn u32(&mut self) -> Option<u32> {
        let (head, rest) = self.0.split_at_checked(4)?;
        self.0 = rest;
        Some(u32::from_be_bytes(head.try_into().ok()?))
    }

    fn string(&mut self) -> Option<&'a [u8]> {
        let len = self.u32()? as usize;
        let (head, rest) = self.0.split_at_checked(len)?;
        self.0 = rest;
        Some(head)
    }
}

fn put_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_be_bytes());
}

fn put_string(out: &mut Vec<u8>, value: &[u8]) {
    put_u32(out, value.len() as u32);
    out.extend_from_slice(value);
}

/// Tạo khoá Ed25519 mới dạng "OPENSSH PRIVATE KEY" (không passphrase — được kho bí mật bảo vệ).
pub fn generate_ed25519(comment: &str) -> Result<(String, PublicKey)> {
    let mut seed = [0u8; 32];
    getrandom::getrandom(&mut seed).map_err(|_| AppError::Internal("Không lấy được số ngẫu nhiên của hệ điều hành".into()))?;
    let signing = ed25519_dalek::SigningKey::from_bytes(&seed);
    let public = signing.verifying_key().to_bytes();

    let mut blob = Vec::new();
    put_string(&mut blob, b"ssh-ed25519");
    put_string(&mut blob, &public);

    let mut check = [0u8; 4];
    getrandom::getrandom(&mut check).map_err(|_| AppError::Internal("Không lấy được số ngẫu nhiên của hệ điều hành".into()))?;
    let mut secret = Vec::new();
    secret.extend_from_slice(&check);
    secret.extend_from_slice(&check);
    put_string(&mut secret, b"ssh-ed25519");
    put_string(&mut secret, &public);
    let mut pair = seed.to_vec();
    pair.extend_from_slice(&public);
    put_string(&mut secret, &pair);
    put_string(&mut secret, comment.as_bytes());
    let mut pad = 1u8;
    while secret.len() % 8 != 0 {
        secret.push(pad);
        pad += 1;
    }

    let mut body = MAGIC.to_vec();
    put_string(&mut body, b"none");
    put_string(&mut body, b"none");
    put_string(&mut body, b"");
    put_u32(&mut body, 1);
    put_string(&mut body, &blob);
    put_string(&mut body, &secret);

    let encoded = STANDARD.encode(&body);
    let mut pem = String::from(BEGIN);
    pem.push('\n');
    for chunk in encoded.as_bytes().chunks(70) {
        pem.push_str(std::str::from_utf8(chunk).unwrap_or_default());
        pem.push('\n');
    }
    pem.push_str(END);
    pem.push('\n');
    Ok((pem, PublicKey { blob, comment: comment.to_string() }))
}

/// Khoá công khai + có passphrase không, đọc từ khoá bí mật dạng OpenSSH (phần khoá công khai không mã hoá).
pub fn inspect_openssh(private_key: &str) -> Option<(PublicKey, bool)> {
    let start = private_key.find(BEGIN)? + BEGIN.len();
    let end = start + private_key[start..].find(END)?;
    let base64: String = private_key[start..end].chars().filter(|c| !c.is_whitespace()).collect();
    let body = STANDARD.decode(base64).ok()?;
    let rest = body.strip_prefix(MAGIC)?;
    let mut reader = Reader(rest);
    let cipher = reader.string()?;
    reader.string()?;
    reader.string()?;
    if reader.u32()? != 1 {
        return None;
    }
    let key = PublicKey { blob: reader.string()?.to_vec(), comment: String::new() };
    key.kind()?;
    Some((key, cipher != b"none"))
}

/// Có dạng khoá bí mật PEM (OpenSSH, RSA/EC kiểu cũ, PKCS#8).
pub fn looks_like_private_key(text: &str) -> bool {
    text.len() < MAX_PRIVATE_KEY_BYTES && text.contains("-----BEGIN ") && text.contains(" PRIVATE KEY-----")
}

// MARK: - Danh sách khoá

/// Một khoá SSH — phần webview được thấy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyInfo {
    pub id: String,
    pub name: String,
    pub public_key: String,
    pub fingerprint: String,
    pub key_type: String,
    pub encrypted: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SshKeysFile {
    #[serde(default)]
    keys: Vec<SshKeyInfo>,
    #[serde(default = "enabled_default")]
    enabled: bool,
}

fn enabled_default() -> bool {
    true
}

impl Default for SshKeysFile {
    fn default() -> Self {
        Self { keys: Vec::new(), enabled: true }
    }
}

/// Danh sách khoá + trạng thái bật cho webview.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeysView {
    pub keys: Vec<SshKeyInfo>,
    pub enabled: bool,
}

pub struct SshKeys {
    path: PathBuf,
    secrets: Arc<dyn SecretStore>,
    file: Mutex<SshKeysFile>,
}

fn secret_key(id: &str, part: &str) -> String {
    format!("ssh/{id}/{part}")
}

impl SshKeys {
    pub fn load(data_dir: &Path, secrets: Arc<dyn SecretStore>) -> Arc<Self> {
        let path = data_dir.join("ssh-keys.json");
        let file = std::fs::read(&path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
        Arc::new(Self { path, secrets, file: Mutex::new(file) })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, SshKeysFile> {
        self.file.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn commit(&self, file: SshKeysFile) -> Result<()> {
        crate::store::write_json(&self.path, &file)?;
        *self.lock() = file;
        Ok(())
    }

    pub fn view(&self) -> SshKeysView {
        let file = self.lock();
        SshKeysView { keys: file.keys.clone(), enabled: file.enabled }
    }

    pub fn set_enabled(&self, enabled: bool) -> Result<SshKeysView> {
        let mut file = self.lock().clone();
        file.enabled = enabled;
        self.commit(file)?;
        Ok(self.view())
    }

    pub fn generate(&self, name: &str, comment: &str) -> Result<SshKeyInfo> {
        let (private_key, public) = generate_ed25519(comment)?;
        self.add(name, &private_key, public, false)
    }

    /// Nhập khoá bí mật (nội dung file). `public_line`: nội dung file .pub đi kèm — bắt buộc với khoá không ở dạng OpenSSH.
    pub fn import(&self, name: &str, private_key: &str, public_line: Option<&str>) -> Result<SshKeyInfo> {
        if !looks_like_private_key(private_key) {
            return Err(AppError::Policy(
                "File này không phải khoá SSH bí mật mà Thaigit đọc được — hãy chọn file khoá bí mật (vd. id_ed25519), không phải file .pub".into(),
            ));
        }
        let given = public_line.and_then(PublicKey::parse_line);
        let (public, encrypted) = match inspect_openssh(private_key) {
            Some((mut public, encrypted)) => {
                if let Some(given) = given.filter(|g| g.blob == public.blob) {
                    public.comment = given.comment;
                }
                (public, encrypted)
            }
            None => match given {
                Some(public) => (public, private_key.contains("ENCRYPTED")),
                None => {
                    return Err(AppError::Policy(
                        "Khoá này ở định dạng cũ — hãy để file .pub cùng thư mục với khoá rồi nhập lại".into(),
                    ));
                }
            },
        };
        self.add(name, private_key, public, encrypted)
    }

    fn add(&self, name: &str, private_key: &str, public: PublicKey, encrypted: bool) -> Result<SshKeyInfo> {
        let name = clean_name(name)?;
        let fingerprint = public.fingerprint();
        if self.lock().keys.iter().any(|key| key.fingerprint == fingerprint) {
            return Err(AppError::Conflict("Khoá SSH này đã có trong Thaigit".into()));
        }
        let info = SshKeyInfo {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            public_key: public.line(),
            fingerprint,
            key_type: public.display_kind(),
            encrypted,
            created_at: crate::accounts::now_rfc3339(),
        };
        self.save_secret(&info.id, private_key)?;
        let mut file = self.lock().clone();
        file.keys.push(info.clone());
        if let Err(error) = self.commit(file) {
            let _ = self.delete_secret(&info.id);
            return Err(error);
        }
        Ok(info)
    }

    pub fn rename(&self, id: &str, name: &str) -> Result<SshKeysView> {
        let name = clean_name(name)?;
        let mut file = self.lock().clone();
        let key = file.keys.iter_mut().find(|key| key.id == id).ok_or_else(|| AppError::NotFound("Không tìm thấy khoá SSH này".into()))?;
        key.name = name;
        self.commit(file)?;
        Ok(self.view())
    }

    pub fn remove(&self, id: &str) -> Result<SshKeysView> {
        self.delete_secret(id)?;
        let mut file = self.lock().clone();
        file.keys.retain(|key| key.id != id);
        self.commit(file)?;
        Ok(self.view())
    }

    pub fn public_key(&self, id: &str) -> Option<SshKeyInfo> {
        self.lock().keys.iter().find(|key| key.id == id).cloned()
    }

    /// Khoá bí mật của mọi khoá (bỏ qua khoá đọc lỗi). Rỗng khi tắt hoặc chưa có khoá.
    pub fn private_keys(&self) -> Vec<String> {
        let (enabled, ids): (bool, Vec<String>) = {
            let file = self.lock();
            (file.enabled, file.keys.iter().map(|key| key.id.clone()).collect())
        };
        if !enabled {
            return Vec::new();
        }
        ids.iter().filter_map(|id| self.read_secret(id)).collect()
    }

    pub fn has_keys(&self) -> bool {
        let file = self.lock();
        file.enabled && !file.keys.is_empty()
    }

    fn save_secret(&self, id: &str, private_key: &str) -> Result<()> {
        let chunks: Vec<&str> = split_chunks(private_key, SECRET_CHUNK);
        for (index, chunk) in chunks.iter().enumerate() {
            self.secrets.set(&secret_key(id, &index.to_string()), chunk)?;
        }
        self.secrets.set(&secret_key(id, "n"), &chunks.len().to_string())
    }

    fn read_secret(&self, id: &str) -> Option<String> {
        let count: usize = self.secrets.get(&secret_key(id, "n")).ok()??.parse().ok()?;
        let mut text = String::new();
        for index in 0..count.min(64) {
            text.push_str(&self.secrets.get(&secret_key(id, &index.to_string())).ok()??);
        }
        Some(text)
    }

    fn delete_secret(&self, id: &str) -> Result<()> {
        let count: usize = self.secrets.get(&secret_key(id, "n"))?.and_then(|n| n.parse().ok()).unwrap_or(0);
        for index in 0..count.min(64) {
            self.secrets.delete(&secret_key(id, &index.to_string()))?;
        }
        self.secrets.delete(&secret_key(id, "n"))
    }
}

fn split_chunks(text: &str, size: usize) -> Vec<&str> {
    let mut chunks = Vec::new();
    let mut rest = text;
    while !rest.is_empty() {
        let mut cut = size.min(rest.len());
        while !rest.is_char_boundary(cut) {
            cut -= 1;
        }
        chunks.push(&rest[..cut]);
        rest = &rest[cut..];
    }
    chunks
}

fn clean_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 || name.chars().any(char::is_control) {
        return Err(AppError::Policy("Tên khoá phải có 1–100 ký tự, không xuống dòng".into()));
    }
    Ok(name.to_string())
}

// MARK: - Remote SSH

/// Địa chỉ remote đi qua SSH: `ssh://…`, `git+ssh://…` hoặc dạng scp `git@github.com:owner/repo.git`.
pub fn is_ssh_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    if let Some(index) = lower.find("://") {
        return matches!(&lower[..index], "ssh" | "git+ssh" | "ssh+git");
    }
    if lower.starts_with('/') || lower.starts_with('.') || lower.starts_with('~') || lower.starts_with('\\') {
        return false;
    }
    match lower.find(':') {
        // `C:\repo` / `C:/repo` là đường dẫn Windows (host một ký tự).
        Some(colon) => colon > 1 && !lower[..colon].contains('/') && !lower[..colon].contains('\\'),
        None => false,
    }
}

// MARK: - ssh-agent tạm

/// Tìm `ssh-agent` / `ssh-add` / `ssh`: cạnh git (Git for Windows: `<gốc>\usr\bin`), rồi trong các thư mục tìm git.
pub fn find_tool(name: &str, git_path: &Path, search_dirs: &[PathBuf]) -> Option<PathBuf> {
    let file = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(bin) = git_path.parent() {
        for root in bin.ancestors().take(4) {
            dirs.push(root.join("usr").join("bin"));
        }
        dirs.push(bin.to_path_buf());
    }
    if cfg!(unix) {
        dirs.push(PathBuf::from("/usr/bin"));
    }
    dirs.extend(search_dirs.iter().cloned());
    dirs.into_iter().map(|dir| dir.join(&file)).find(|candidate| candidate.is_file())
}

/// ssh-agent chỉ sống trong một lệnh git. Drop = dừng agent + xoá thư mục socket.
pub struct SshAgent {
    child: Child,
    dir: PathBuf,
    socket: PathBuf,
}

impl SshAgent {
    /// Dựng agent rồi nạp `keys` (khoá nào nạp lỗi — sai passphrase, huỷ hộp thoại… — thì bỏ qua). `env`: môi trường của lệnh
    /// git (để ssh-add hỏi passphrase qua askpass của app).
    pub fn start(agent: &Path, add: &Path, keys: &[String], env: &[(OsString, OsString)]) -> Result<SshAgent> {
        let unavailable = || AppError::Io("Không chạy được ssh-agent nên chưa dùng được khoá SSH của Thaigit".into());
        let base = if cfg!(unix) { PathBuf::from("/tmp") } else { std::env::temp_dir() };
        let dir = base.join(format!("thaigit-ssh-{}", &uuid::Uuid::new_v4().simple().to_string()[..12]));
        create_private_dir(&dir).map_err(|_| unavailable())?;
        let socket = dir.join("agent");
        let socket_arg = socket_string(&socket);

        let mut command = Command::new(agent);
        command.args(["-D", "-a"]).arg(&socket_arg);
        configure(&mut command, env, None);
        let child = match command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn() {
            Ok(child) => child,
            Err(_) => {
                let _ = std::fs::remove_dir_all(&dir);
                return Err(unavailable());
            }
        };
        let mut session = SshAgent { child, dir, socket };
        let mut waited = 0;
        while !session.socket.exists() {
            if waited >= 3000 || matches!(session.child.try_wait(), Ok(Some(_))) {
                return Err(unavailable());
            }
            std::thread::sleep(Duration::from_millis(10));
            waited += 10;
        }
        for key in keys {
            let mut command = Command::new(add);
            command.args(["-q", "-t", &AGENT_KEY_LIFETIME_S.to_string(), "-"]);
            configure(&mut command, env, Some(&socket_arg));
            let Ok(mut child) = command.stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn() else { continue };
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(key.as_bytes());
            }
            let _ = wait_with_timeout(&mut child, Duration::from_secs(120));
        }
        Ok(session)
    }

    /// Giá trị `SSH_AUTH_SOCK` cho lệnh git.
    pub fn socket(&self) -> OsString {
        OsString::from(socket_string(&self.socket))
    }

    /// Đặt `SSH_AUTH_SOCK` của agent này vào env đã dựng của lệnh git.
    pub fn apply(&self, env: &mut Vec<(OsString, OsString)>) {
        env.retain(|(key, _)| !key.to_string_lossy().eq_ignore_ascii_case("SSH_AUTH_SOCK"));
        env.push((OsString::from("SSH_AUTH_SOCK"), self.socket()));
    }
}

impl Drop for SshAgent {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// Đường dẫn socket dạng ssh của Git for Windows hiểu được (dấu `/`).
fn socket_string(path: &Path) -> String {
    let text = path.to_string_lossy().into_owned();
    if cfg!(windows) { text.replace('\\', "/") } else { text }
}

fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        std::fs::DirBuilder::new().mode(0o700).create(dir)
    }
    #[cfg(not(unix))]
    {
        std::fs::create_dir(dir)
    }
}

fn configure(command: &mut Command, env: &[(OsString, OsString)], socket: Option<&str>) {
    command.env_clear();
    for (key, value) in env {
        let name = key.to_string_lossy();
        if name.eq_ignore_ascii_case("SSH_AUTH_SOCK") || name.eq_ignore_ascii_case("SSH_AGENT_PID") {
            continue;
        }
        command.env(key, value);
    }
    if let Some(socket) = socket {
        command.env("SSH_AUTH_SOCK", socket);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn wait_with_timeout(child: &mut Child, limit: Duration) -> Option<std::process::ExitStatus> {
    let mut waited = Duration::ZERO;
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            return Some(status);
        }
        if waited >= limit {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(Duration::from_millis(20));
        waited += Duration::from_millis(20);
    }
}

// MARK: - Kiểm tra kết nối

/// Đọc lời chào của GitHub / GitLab sau `ssh -T git@<host>`.
pub fn connection_message(output: &str, host: &str) -> std::result::Result<String, String> {
    for line in output.lines() {
        if let (Some(start), Some(end)) = (line.find("Hi "), line.find("! You've successfully authenticated")) {
            return Ok(format!("Đã kết nối {host} với tài khoản @{}", &line[start + 3..end]));
        }
        if let Some(start) = line.find("Welcome to GitLab, ") {
            let user = line[start + 19..].trim_matches(|c: char| c == '@' || c == '!' || c.is_whitespace());
            return Ok(format!("Đã kết nối {host} với tài khoản @{user}"));
        }
        if line.contains("successfully authenticated") || line.contains("logged in as") {
            return Ok(format!("Đã kết nối {host}"));
        }
    }
    if output.contains("Permission denied") {
        return Err(format!("{host} chưa nhận khoá nào của Thaigit — hãy thêm khoá công khai lên tài khoản trước"));
    }
    if output.contains("Host key verification failed") || output.contains("REMOTE HOST IDENTIFICATION HAS CHANGED") {
        return Err(format!("Khoá của máy chủ {host} không khớp với lần trước (known_hosts) — kiểm tra lại mạng trước khi tiếp tục"));
    }
    Err(format!("Không kết nối được tới {host} qua SSH — kiểm tra mạng hoặc tường lửa (cổng 22)"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::MemoryStore;

    fn keygen() -> Option<PathBuf> {
        // Windows: ssh-keygen của Git for Windows kiểm quyền file khoá theo ACL — chỉ đối chiếu trên Unix.
        if cfg!(windows) {
            return None;
        }
        let found = find_tool("ssh-keygen", Path::new("/usr/bin/git"), &[]);
        if found.is_none() {
            eprintln!("bỏ qua: không có ssh-keygen");
        }
        found
    }

    #[test]
    fn generated_keys_are_valid_openssh() {
        let (pem, public) = generate_ed25519("thai@may").unwrap();
        assert_eq!(public.kind().as_deref(), Some("ssh-ed25519"));
        assert!(public.line().starts_with("ssh-ed25519 AAAA") && public.line().ends_with(" thai@may"));
        let (inspected, encrypted) = inspect_openssh(&pem).unwrap();
        assert_eq!(inspected.blob, public.blob);
        assert!(!encrypted);
        assert!(public.fingerprint().starts_with("SHA256:") && !public.fingerprint().ends_with('='));

        let Some(keygen) = keygen() else { return };
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("id");
        std::fs::write(&file, &pem).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).unwrap();
        }
        let output = Command::new(&keygen).arg("-y").arg("-f").arg(&file).output().unwrap();
        let derived = PublicKey::parse_line(&String::from_utf8_lossy(&output.stdout)).unwrap();
        assert_eq!(derived.blob, public.blob);
        let output = Command::new(&keygen).arg("-l").arg("-f").arg(&file).output().unwrap();
        assert!(String::from_utf8_lossy(&output.stdout).contains(&public.fingerprint()));
    }

    #[test]
    fn keys_are_stored_in_chunks_and_never_in_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let secrets = Arc::new(MemoryStore::default());
        let keys = SshKeys::load(dir.path(), secrets.clone());
        let info = keys.generate("Laptop", "a@b").unwrap();
        // Khoá dài (giả RSA 4096) cũng lưu được qua nhiều mục.
        let long = format!("-----BEGIN OPENSSH PRIVATE KEY-----\n{}\n-----END OPENSSH PRIVATE KEY-----\n", "A".repeat(3300));
        keys.save_secret("dai", &long).unwrap();
        assert_eq!(keys.read_secret("dai").as_deref(), Some(long.as_str()));
        assert_eq!(secrets.get(&secret_key("dai", "n")).unwrap().as_deref(), Some("2"));

        let text = std::fs::read_to_string(dir.path().join("ssh-keys.json")).unwrap();
        assert!(!text.contains("PRIVATE KEY"));
        assert_eq!(keys.private_keys().len(), 1);

        let reopened = SshKeys::load(dir.path(), secrets.clone());
        assert_eq!(reopened.view().keys, vec![info.clone()]);
        let private = reopened.private_keys().remove(0);
        assert!(matches!(reopened.import("Lại", &private, None), Err(AppError::Conflict(_))));
        assert!(matches!(reopened.import("Pub", &info.public_key, None), Err(AppError::Policy(_))));
        assert!(matches!(reopened.rename(&info.id, " \n "), Err(AppError::Policy(_))));
        reopened.rename(&info.id, " Máy công ty ").unwrap();
        assert_eq!(reopened.view().keys[0].name, "Máy công ty");

        reopened.set_enabled(false).unwrap();
        assert!(reopened.private_keys().is_empty());
        reopened.set_enabled(true).unwrap();
        reopened.remove(&info.id).unwrap();
        assert!(reopened.view().keys.is_empty());
        assert!(secrets.get(&secret_key(&info.id, "0")).unwrap().is_none());
    }

    #[test]
    fn imports_legacy_keys_only_with_their_public_key() {
        let dir = tempfile::tempdir().unwrap();
        let keys = SshKeys::load(dir.path(), Arc::new(MemoryStore::default()));
        let legacy = "-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----\n";
        assert!(matches!(keys.import("cu", legacy, None), Err(AppError::Policy(_))));
        let (_, public) = generate_ed25519("x").unwrap();
        let info = keys.import("cu", legacy, Some(&public.line())).unwrap();
        assert_eq!(info.fingerprint, public.fingerprint());
    }

    #[test]
    fn detects_ssh_remotes() {
        assert!(is_ssh_url("git@github.com:owner/repo.git"));
        assert!(is_ssh_url("ssh://git@gitlab.cong-ty.vn:2222/nhom/repo.git"));
        assert!(is_ssh_url("git+ssh://git@github.com/a/b"));
        assert!(!is_ssh_url("https://github.com/owner/repo.git"));
        assert!(!is_ssh_url("C:\\repos\\app"));
        assert!(!is_ssh_url("C:/repos/app"));
        assert!(!is_ssh_url("/home/a/repo"));
        assert!(!is_ssh_url("../repo"));
        assert!(!is_ssh_url("file:///tmp/repo"));
    }

    #[test]
    fn reads_connection_greetings() {
        assert_eq!(
            connection_message("Hi alice! You've successfully authenticated, but GitHub does not provide shell access.", "github.com"),
            Ok("Đã kết nối github.com với tài khoản @alice".into())
        );
        assert_eq!(connection_message("Welcome to GitLab, @bob!", "gitlab.com"), Ok("Đã kết nối gitlab.com với tài khoản @bob".into()));
        assert!(connection_message("git@github.com: Permission denied (publickey).", "github.com").unwrap_err().contains("chưa nhận"));
    }

    #[test]
    fn agent_serves_keys_without_files_and_cleans_up() {
        let git = Path::new(if cfg!(windows) { "C:\\Program Files\\Git\\cmd\\git.exe" } else { "/usr/bin/git" });
        let (Some(agent), Some(add)) = (find_tool("ssh-agent", git, &[]), find_tool("ssh-add", git, &[])) else {
            eprintln!("bỏ qua: không có ssh-agent");
            return;
        };
        let (pem, public) = generate_ed25519("agent-test").unwrap();
        let env: Vec<(OsString, OsString)> = std::env::vars_os().collect();
        let session = SshAgent::start(&agent, &add, &[pem], &env).unwrap();
        let mut command = Command::new(&add);
        command.arg("-l");
        configure(&mut command, &env, Some(&session.socket().to_string_lossy()));
        let output = command.output().unwrap();
        assert!(String::from_utf8_lossy(&output.stdout).contains(&public.fingerprint()), "{output:?}");
        let dir = session.dir.clone();
        drop(session);
        assert!(!dir.exists());
    }
}
