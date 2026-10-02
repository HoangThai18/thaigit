//! Repo lạ (trust gate): quét cấu hình/hook có thể chạy lệnh, chế độ hạn chế và lưu quyết định tin cậy.
//!
//! `open_repo` chạy `git config --list --show-scope --show-origin -z` (đã gắn cờ `-c` cứng), lọc mục thuộc scope
//! `local`/`worktree` (gồm file `include`) khớp khoá chạy lệnh, cộng hook không phải `.sample`. Không có gì → mở bình
//! thường. Có → `unknown` cho tới khi người dùng tin tưởng. Chưa tin = chế độ hạn chế: Rust đặt lại `core.hooksPath`
//! về thư mục rỗng của app và ghi đè từng khoá tìm thấy bằng giá trị global/system hoặc giá trị vô hiệu (qua
//! `GIT_CONFIG_COUNT/KEY_n/VALUE_n` — không có nhập nhằng dấu `=` như `-c`), không auto-fetch.
//!
//! Ghi đè dựng từ lần quét lúc mở nên có thể ĐÃ CŨ khi cấu hình hiệu lực đổi mà `.git/config` không đổi (`include` tới file
//! đã track đổi theo nhánh, `includeIf onbranch:`). Hai lớp chặn: (1) vân tay (`registry::ConfigFingerprint`) gồm mọi file
//! `file:` của lần quét + đích include + HEAD, đổi thì quét lại trước lệnh kế tiếp; (2) repo có `include*` (hay nguồn cấu hình
//! không theo dõi được) là `fail_closed`: chỉ lệnh đọc thuần tuý (`GitPolicy::is_exec_free`) chạy tới khi tin tưởng. Các
//! chương trình gpg (tên khoá cố định) luôn được ghim sẵn, không chờ lần quét thấy.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::errors::{AppError, Result};
use crate::store;

/// Một dòng của `git config --list --show-scope --show-origin -z`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigEntry {
    pub scope: String,
    pub origin: String,
    /// Khoá do git in ra: phần section/variable chữ thường, subsection giữ nguyên.
    pub key: String,
    pub value: String,
}

impl ConfigEntry {
    /// Do repo kiểm soát (file `.git/config`, `config.worktree` và file được include từ đó).
    pub fn repo_controlled(&self) -> bool {
        self.scope == "local" || self.scope == "worktree"
    }

    /// Do người dùng/hệ thống kiểm soát (scope `command` là cờ `-c` của chính app nên bỏ qua).
    pub fn user_controlled(&self) -> bool {
        matches!(self.scope.as_str(), "system" | "global" | "unknown")
    }
}

/// Parse output `-z`: mỗi mục là `scope NUL origin NUL key NEWLINE value NUL` (khoá không có giá trị: `key NUL`).
pub fn parse_config_list(bytes: &[u8]) -> Vec<ConfigEntry> {
    let mut tokens: Vec<&[u8]> = bytes.split(|b| *b == 0).collect();
    if tokens.last().is_some_and(|t| t.is_empty()) {
        tokens.pop();
    }
    let (chunks, _) = tokens.as_chunks::<3>();
    chunks
        .iter()
        .map(|chunk| {
            let (key, value) = match chunk[2].iter().position(|b| *b == b'\n') {
                Some(index) => (&chunk[2][..index], &chunk[2][index + 1..]),
                None => (chunk[2], &b""[..]),
            };
            ConfigEntry {
                scope: String::from_utf8_lossy(chunk[0]).into_owned(),
                origin: String::from_utf8_lossy(chunk[1]).into_owned(),
                key: String::from_utf8_lossy(key).into_owned(),
                value: String::from_utf8_lossy(value).into_owned(),
            }
        })
        .collect()
}

/// Nhóm khoá chạy được lệnh.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum KeyKind {
    Fsmonitor,
    HooksPath,
    SshCommand,
    AskPass,
    GitProxy,
    Editor,
    Pager,
    Worktree,
    Filter,
    DiffDriver,
    DiffExternal,
    MergeDriver,
    CredentialHelper,
    GpgProgram,
    RemoteUploadPack,
    RemoteReceivePack,
    RemoteVcs,
    ProtocolAllow,
    UrlRewrite,
    Include,
    /// `sequence.editor` (`rebase -i`): thắng `GIT_EDITOR` nên không thể dựa vào `GIT_EDITOR=true`.
    SequenceEditor,
    /// `trailer.<token>.cmd|command` (`commit --trailer`, `interpret-trailers`).
    TrailerCommand,
    /// `core.alternateRefsCommand` (fetch/push khi repo có alternates).
    AlternateRefsCommand,
    /// `gpg.ssh.defaultKeyCommand` (ký bằng ssh khi chưa chọn khoá).
    SshDefaultKeyCommand,
    /// `submodule.<tên>.update = !lệnh` (`pull --recurse-submodules` → `submodule update`).
    SubmoduleUpdate,
}

static KEY_PATTERNS: LazyLock<Vec<(Regex, KeyKind)>> = LazyLock::new(|| {
    let table: &[(&str, KeyKind)] = &[
        (r"^core\.fsmonitor$", KeyKind::Fsmonitor),
        (r"^core\.hookspath$", KeyKind::HooksPath),
        (r"^core\.sshcommand$", KeyKind::SshCommand),
        (r"^core\.askpass$", KeyKind::AskPass),
        (r"^core\.gitproxy$", KeyKind::GitProxy),
        (r"^core\.editor$", KeyKind::Editor),
        (r"^core\.pager$", KeyKind::Pager),
        (r"^core\.worktree$", KeyKind::Worktree),
        (r"^filter\..+\.(clean|smudge|process)$", KeyKind::Filter),
        (r"^diff\..+\.(textconv|command)$", KeyKind::DiffDriver),
        (r"^diff\.external$", KeyKind::DiffExternal),
        (r"^merge\..+\.driver$", KeyKind::MergeDriver),
        (r"^credential\.(.+\.)?helper$", KeyKind::CredentialHelper),
        (r"^gpg\.(.+\.)?program$", KeyKind::GpgProgram),
        (r"^remote\..+\.uploadpack$", KeyKind::RemoteUploadPack),
        (r"^remote\..+\.receivepack$", KeyKind::RemoteReceivePack),
        (r"^remote\..+\.vcs$", KeyKind::RemoteVcs),
        (r"^protocol\.(.+\.)?allow$", KeyKind::ProtocolAllow),
        (r"^url\..+\.(pushinsteadof|insteadof)$", KeyKind::UrlRewrite),
        (r"^include\.path$", KeyKind::Include),
        (r"^includeif\..+\.path$", KeyKind::Include),
        (r"^sequence\.editor$", KeyKind::SequenceEditor),
        (r"^trailer\..+\.(cmd|command)$", KeyKind::TrailerCommand),
        (r"^core\.alternaterefscommand$", KeyKind::AlternateRefsCommand),
        (r"^gpg\.ssh\.defaultkeycommand$", KeyKind::SshDefaultKeyCommand),
        (r"^submodule\..+\.update$", KeyKind::SubmoduleUpdate),
    ];
    table.iter().map(|(pattern, kind)| (Regex::new(pattern).expect("regex khoá hợp lệ"), *kind)).collect()
});

pub fn classify_key(key: &str) -> Option<KeyKind> {
    KEY_PATTERNS.iter().find(|(pattern, _)| pattern.is_match(key)).map(|(_, kind)| *kind)
}

/// File hook không phải `.sample` trong `<commonDir>/hooks`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookFile {
    pub name: String,
    pub digest: String,
}

pub fn read_hooks(common_dir: &Path) -> Vec<HookFile> {
    let Ok(entries) = std::fs::read_dir(common_dir.join("hooks")) else {
        return Vec::new();
    };
    let mut hooks: Vec<HookFile> = entries
        .filter_map(|e| e.ok())
        .filter(|e| !e.file_name().to_string_lossy().ends_with(".sample"))
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file() || t.is_symlink()))
        .map(|e| {
            let digest = std::fs::metadata(e.path())
                .ok()
                .filter(|m| m.len() <= 1024 * 1024)
                .and_then(|_| std::fs::read(e.path()).ok())
                .map(|bytes| hex(&Sha256::digest(&bytes)))
                .unwrap_or_else(|| "không-đọc-được".to_string());
            HookFile { name: e.file_name().to_string_lossy().into_owned(), digest }
        })
        .collect();
    hooks.sort_by(|a, b| a.name.cmp(&b.name));
    hooks
}

pub fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut out, b| {
        let _ = write!(out, "{b:02x}");
        out
    })
}

/// Khoá/hook đáng ngờ tìm thấy (để hiện cho người dùng khi hỏi tin tưởng).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    pub label: String,
    pub kind: Option<KeyKind>,
    /// Dòng cho hộp thoại: `core.fsmonitor = /x/cmd  (local, file:.git/config)`.
    pub display: String,
}

const MAX_DISPLAY_VALUE: usize = 160;

fn truncate(text: &str) -> String {
    if text.chars().count() <= MAX_DISPLAY_VALUE {
        text.to_string()
    } else {
        format!("{}…", text.chars().take(MAX_DISPLAY_VALUE).collect::<String>())
    }
}

/// Mục cấu hình do repo kiểm soát khớp khoá chạy lệnh + hook. Dòng hiển thị nào trùng thì chỉ giữ lần xuất hiện đầu (giữ thứ
/// tự): khoá đa trị hoặc cùng giá trị ở nhiều file include cho ra các dòng giống hệt, mà giao diện dùng dòng đó làm khoá danh sách.
pub fn find_findings(entries: &[ConfigEntry], hooks: &[HookFile]) -> Vec<Finding> {
    let mut findings: Vec<Finding> = entries
        .iter()
        .filter(|e| e.repo_controlled())
        .filter_map(|e| {
            let kind = classify_key(&e.key)?;
            Some(Finding {
                label: e.key.clone(),
                kind: Some(kind),
                display: format!("{} = {}  ({}, {})", e.key, truncate(&e.value), e.scope, e.origin),
            })
        })
        .collect();
    findings.extend(hooks.iter().map(|h| Finding {
        label: format!("hook:{}", h.name),
        kind: None,
        display: format!("hook: {}", h.name),
    }));
    let mut seen: BTreeSet<String> = BTreeSet::new();
    findings.retain(|finding| seen.insert(finding.display.clone()));
    findings
}

/// Băm tập khoá chạy lệnh + hook (tập đổi → hỏi lại tin cậy).
pub fn findings_hash(entries: &[ConfigEntry], hooks: &[HookFile]) -> String {
    let mut lines: BTreeSet<String> = entries
        .iter()
        .filter(|e| e.repo_controlled() && classify_key(&e.key).is_some())
        .map(|e| format!("cfg\t{}\t{}\t{}", e.scope, e.key, e.value))
        .collect();
    lines.extend(hooks.iter().map(|h| format!("hook\t{}\t{}", h.name, h.digest)));
    let mut hasher = Sha256::new();
    for line in &lines {
        hasher.update(line.as_bytes());
        hasher.update(b"\n");
    }
    hex(&hasher.finalize())
}

/// Ghi đè cho chế độ hạn chế.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Restrictions {
    /// `(khoá, giá trị)` đặt qua `GIT_CONFIG_*` (scope `command`, thắng cấu hình repo).
    pub config: Vec<(String, String)>,
    /// `GIT_PROXY_COMMAND` (git chỉ nhìn giá trị cấu hình đầu tiên của `core.gitproxy`, nên phải dùng env).
    pub proxy_command: Option<String>,
    /// Có khoá không vô hiệu hoá được bằng ghi đè (`url.*.insteadOf` đổi đích, `include*` nạp thêm file về sau,
    /// `remote.*.uploadpack/receivepack` mà git chỉ nhận giá trị đầu tiên): thao tác mạng bị chặn cho tới khi tin tưởng.
    pub blocks_network: bool,
    /// Cấu hình có thể đổi hiệu lực mà ta không theo dõi chắc chắn được: `include`/`includeIf` trỏ tới file khác (kể cả file
    /// ĐÃ TRACK nên đổi nội dung khi chuyển nhánh, hay `includeIf onbranch:` bật/tắt theo nhánh) hoặc nguồn không phải file.
    /// Các ghi đè dựng từ lần quét có thể đã cũ nên mọi lệnh có thể chạy lệnh do cấu hình chỉ định (bộ lọc, textconv, merge
    /// driver…) bị chặn tới khi tin tưởng; chỉ còn lệnh đọc thuần tuý (`GitPolicy::is_exec_free`). Luôn kéo theo `blocks_network`.
    pub fail_closed: bool,
}

impl Restrictions {
    /// Env cho tiến trình git: `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_i`, `GIT_CONFIG_VALUE_i`, `GIT_PROXY_COMMAND`.
    pub fn env(&self) -> Vec<(String, String)> {
        let mut env = vec![("GIT_CONFIG_COUNT".to_string(), self.config.len().to_string())];
        for (index, (key, value)) in self.config.iter().enumerate() {
            env.push((format!("GIT_CONFIG_KEY_{index}"), key.clone()));
            env.push((format!("GIT_CONFIG_VALUE_{index}"), value.clone()));
        }
        if let Some(command) = &self.proxy_command {
            env.push(("GIT_PROXY_COMMAND".to_string(), command.clone()));
        }
        env
    }
}

fn last_trusted<'a>(entries: &'a [ConfigEntry], key: &str) -> Option<&'a str> {
    entries.iter().rev().find(|e| e.user_controlled() && e.key == key).map(|e| e.value.as_str())
}

/// Chương trình ký/kiểm chữ ký: tên khoá cố định nên luôn được ghim về giá trị của người dùng (hoặc mặc định), kể cả khi lần quét
/// không thấy khoá (vd. nằm trong file `include` đổi theo nhánh). `log --format=%G?`/`%(signature)` chạy chương trình này.
const GPG_PINNED: [(&[&str], &str); 3] =
    [(&["gpg.program", "gpg.openpgp.program"], "gpg"), (&["gpg.x509.program"], "gpgsm"), (&["gpg.ssh.program"], "ssh-keygen")];

fn last_trusted_of<'a>(entries: &'a [ConfigEntry], keys: &[&str]) -> Option<&'a str> {
    entries.iter().rev().find(|e| e.user_controlled() && keys.contains(&e.key.as_str())).map(|e| e.value.as_str())
}

/// Dựng ghi đè cho repo chưa tin cậy. `empty_hooks` là thư mục rỗng của app (luôn đặt làm `core.hooksPath`).
pub fn build_restrictions(entries: &[ConfigEntry], empty_hooks: &Path) -> Restrictions {
    let mut restrictions = Restrictions::default();
    restrictions.config.push(("core.hooksPath".to_string(), empty_hooks.to_string_lossy().into_owned()));

    let mut handled: BTreeSet<String> = BTreeSet::new();
    for (keys, default) in GPG_PINNED {
        // `gpg.program` và `gpg.openpgp.program` là cùng một biến trong git: ghim cả hai về cùng một giá trị.
        let value = last_trusted_of(entries, keys).unwrap_or(default);
        for key in keys {
            handled.insert((*key).to_string());
            restrictions.config.push(((*key).to_string(), value.to_string()));
        }
    }
    let mut credential_reset_added = false;
    for entry in entries.iter().filter(|e| e.repo_controlled()) {
        // Nguồn không phải file (blob/stdin/…) thì không có gì để theo dõi thay đổi.
        if !entry.origin.starts_with("file:") {
            restrictions.fail_closed = true;
        }
        let Some(kind) = classify_key(&entry.key) else { continue };
        if kind == KeyKind::Include {
            restrictions.fail_closed = true;
        }
        if !handled.insert(entry.key.clone()) {
            continue;
        }
        let trusted = last_trusted(entries, &entry.key);
        let key = entry.key.clone();
        let neutral = |fallback: &str| trusted.unwrap_or(fallback).to_string();
        match kind {
            // `-c core.fsmonitor=false` / `core.pager=cat` / GIT_EDITOR=true đã luôn có; hooksPath đặt sẵn ở trên.
            KeyKind::Fsmonitor | KeyKind::HooksPath | KeyKind::Editor | KeyKind::Pager | KeyKind::Worktree => {}
            KeyKind::SshCommand => restrictions.config.push((key, neutral("ssh"))),
            KeyKind::AskPass => restrictions.config.push((key, neutral(""))),
            KeyKind::GitProxy => {
                let value = trusted.filter(|v| !v.contains(" for ")).unwrap_or("");
                restrictions.proxy_command = Some(value.to_string());
            }
            KeyKind::Filter | KeyKind::DiffDriver | KeyKind::DiffExternal => restrictions.config.push((key, neutral(""))),
            // Driver rỗng sẽ "thành công" mà không gộp gì; `false` buộc báo xung đột (an toàn).
            KeyKind::MergeDriver => restrictions.config.push((key, neutral("false"))),
            KeyKind::CredentialHelper => {
                // Giá trị rỗng xoá toàn bộ danh sách helper đã nạp; rồi thêm lại helper của người dùng/hệ thống
                // (giữ nguyên khoá, kể cả `credential.<url>.helper`).
                if !credential_reset_added {
                    credential_reset_added = true;
                    restrictions.config.push(("credential.helper".to_string(), String::new()));
                    for trusted_entry in entries.iter().filter(|e| e.user_controlled() && classify_key(&e.key) == Some(KeyKind::CredentialHelper)) {
                        restrictions.config.push((trusted_entry.key.clone(), trusted_entry.value.clone()));
                    }
                }
            }
            KeyKind::GpgProgram => {
                // Các khoá cố định đã ghim ở trên; còn lại là `gpg.<định dạng lạ>.program`.
                let default = if key.contains(".ssh.") {
                    "ssh-keygen"
                } else if key.contains(".x509.") {
                    "gpgsm"
                } else {
                    "gpg"
                };
                restrictions.config.push((key, neutral(default)));
            }
            // git chỉ nhận giá trị ĐẦU TIÊN của `remote.<tên>.uploadpack/receivepack` nên cấu hình scope `command` không ghi
            // đè được: coi như không vô hiệu hoá được, chặn lệnh mạng cho tới khi tin tưởng.
            KeyKind::RemoteUploadPack | KeyKind::RemoteReceivePack | KeyKind::UrlRewrite | KeyKind::Include => {
                restrictions.blocks_network = true;
            }
            KeyKind::RemoteVcs => restrictions.config.push((key, neutral(""))),
            // `true`/`false` là chương trình chuẩn không làm gì (giữ nguyên danh sách việc / báo lỗi thay vì chạy lệnh của repo).
            KeyKind::SequenceEditor | KeyKind::AlternateRefsCommand => restrictions.config.push((key, neutral("true"))),
            KeyKind::TrailerCommand | KeyKind::SshDefaultKeyCommand => restrictions.config.push((key, neutral("false"))),
            KeyKind::SubmoduleUpdate => restrictions.config.push((key, neutral("checkout"))),
            KeyKind::ProtocolAllow => {
                let default = if key == "protocol.ext.allow" { "never" } else { "user" };
                restrictions.config.push((key, neutral(default)));
            }
        }
    }
    if restrictions.fail_closed {
        restrictions.blocks_network = true;
    }
    restrictions
}

/// Mọi file cấu hình mà lần quét đã đọc (origin `file:`) cộng đích của mọi khoá `include`/`includeIf` — kể cả file CHƯA tồn tại lúc
/// quét (git bỏ qua file thiếu nhưng nó có thể xuất hiện sau, vd. do chuyển nhánh). Đường dẫn tương đối tính từ `cwd` của lần quét.
pub fn config_files(entries: &[ConfigEntry], cwd: &Path) -> Vec<PathBuf> {
    let resolve = |text: &str| {
        let path = Path::new(text);
        if path.is_absolute() { path.to_path_buf() } else { cwd.join(path) }
    };
    let mut files: BTreeSet<PathBuf> = BTreeSet::new();
    for entry in entries {
        let Some(origin) = entry.origin.strip_prefix("file:") else { continue };
        let origin = resolve(origin);
        if classify_key(&entry.key) == Some(KeyKind::Include)
            && let Some(target) = include_target(&entry.value, origin.parent())
        {
            files.insert(target);
        }
        files.insert(origin);
    }
    files.into_iter().collect()
}

/// Đích của `include.path`: `~/…` theo thư mục nhà, tuyệt đối giữ nguyên, tương đối tính từ thư mục của file chứa dòng include.
fn include_target(value: &str, base: Option<&Path>) -> Option<PathBuf> {
    if let Some(rest) = value.strip_prefix("~/") {
        let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
        return Some(PathBuf::from(home).join(rest));
    }
    let path = Path::new(value);
    if path.is_absolute() { Some(path.to_path_buf()) } else { base.map(|dir| dir.join(path)) }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct TrustFile {
    #[serde(default)]
    entries: BTreeMap<String, String>,
}

/// Quyết định tin cậy đã lưu: `đường dẫn thật → băm tập khoá chạy lệnh`.
pub struct TrustStore {
    path: PathBuf,
    entries: Mutex<BTreeMap<String, String>>,
}

impl TrustStore {
    pub fn new(data_dir: &Path) -> Self {
        let path = data_dir.join("trust.json");
        let entries = store::read_json::<TrustFile>(&path).map(|f| f.entries).unwrap_or_default();
        Self { path, entries: Mutex::new(entries) }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, BTreeMap<String, String>> {
        self.entries.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn is_trusted(&self, path_key: &str, hash: &str) -> bool {
        self.lock().get(path_key).is_some_and(|stored| stored == hash)
    }

    pub fn trust(&self, path_key: &str, hash: &str) -> Result<()> {
        let snapshot = {
            let mut entries = self.lock();
            entries.insert(path_key.to_string(), hash.to_string());
            TrustFile { entries: entries.clone() }
        };
        store::write_json(&self.path, &snapshot).map_err(|e| AppError::Io(format!("Không lưu được quyết định tin cậy: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(scope: &str, key: &str, value: &str) -> ConfigEntry {
        ConfigEntry { scope: scope.into(), origin: "file:.git/config".into(), key: key.into(), value: value.into() }
    }

    #[test]
    fn parses_the_z_format_with_multiline_and_missing_values() {
        let raw = b"system\0file:/etc/gitconfig\0credential.helper\nosxkeychain\0local\0file:.git/config\0core.bare\0local\0file:.git/config\0alias.x\nlog\n--oneline\0";
        let entries = parse_config_list(raw);
        assert_eq!(entries.len(), 3);
        assert_eq!((entries[0].scope.as_str(), entries[0].key.as_str(), entries[0].value.as_str()), ("system", "credential.helper", "osxkeychain"));
        assert_eq!((entries[1].key.as_str(), entries[1].value.as_str()), ("core.bare", ""));
        assert_eq!(entries[2].value, "log\n--oneline");
        assert!(parse_config_list(b"").is_empty());
    }

    #[test]
    fn classifies_every_command_running_key_from_the_plan() {
        let hits = [
            ("core.fsmonitor", KeyKind::Fsmonitor),
            ("core.hookspath", KeyKind::HooksPath),
            ("core.sshcommand", KeyKind::SshCommand),
            ("core.askpass", KeyKind::AskPass),
            ("core.gitproxy", KeyKind::GitProxy),
            ("core.editor", KeyKind::Editor),
            ("core.pager", KeyKind::Pager),
            ("filter.lfs.clean", KeyKind::Filter),
            ("filter.lfs.smudge", KeyKind::Filter),
            ("filter.lfs.process", KeyKind::Filter),
            ("filter.a b.clean", KeyKind::Filter),
            ("diff.word.textconv", KeyKind::DiffDriver),
            ("diff.x.command", KeyKind::DiffDriver),
            ("diff.external", KeyKind::DiffExternal),
            ("merge.union.driver", KeyKind::MergeDriver),
            ("credential.helper", KeyKind::CredentialHelper),
            ("credential.https://github.com.helper", KeyKind::CredentialHelper),
            ("gpg.program", KeyKind::GpgProgram),
            ("gpg.ssh.program", KeyKind::GpgProgram),
            ("remote.origin.uploadpack", KeyKind::RemoteUploadPack),
            ("remote.origin.receivepack", KeyKind::RemoteReceivePack),
            ("remote.origin.vcs", KeyKind::RemoteVcs),
            ("protocol.ext.allow", KeyKind::ProtocolAllow),
            ("protocol.allow", KeyKind::ProtocolAllow),
            ("url.git@github.com:.insteadof", KeyKind::UrlRewrite),
            ("include.path", KeyKind::Include),
            ("includeif.gitdir:/x/.path", KeyKind::Include),
            ("sequence.editor", KeyKind::SequenceEditor),
            ("trailer.sign.cmd", KeyKind::TrailerCommand),
            ("trailer.sign.command", KeyKind::TrailerCommand),
            ("core.alternaterefscommand", KeyKind::AlternateRefsCommand),
            ("gpg.ssh.defaultkeycommand", KeyKind::SshDefaultKeyCommand),
            ("submodule.libs/x.update", KeyKind::SubmoduleUpdate),
        ];
        for (key, kind) in hits {
            assert_eq!(classify_key(key), Some(kind), "{key}");
        }
        for key in [
            "user.name", "core.autocrlf", "remote.origin.url", "branch.main.remote", "core.filemode", "alias.co", "filter.lfs.required",
            "sequence.replaceeditor", "trailer.sign.key", "submodule.x.url", "submodule.recurse", "core.alternaterefsprefixes",
        ] {
            assert_eq!(classify_key(key), None, "{key}");
        }
    }

    #[test]
    fn findings_only_count_repo_controlled_entries_and_non_sample_hooks() {
        let entries = vec![
            entry("global", "core.sshcommand", "ssh -i mine"),
            entry("local", "core.fsmonitor", "touch /tmp/pwned"),
            entry("local", "core.filemode", "true"),
            entry("worktree", "filter.x.clean", "evil"),
            entry("command", "core.fsmonitor", "false"),
        ];
        let hooks = vec![HookFile { name: "pre-commit".into(), digest: "ab".into() }];
        let findings = find_findings(&entries, &hooks);
        let labels: Vec<_> = findings.iter().map(|f| f.label.as_str()).collect();
        assert_eq!(labels, ["core.fsmonitor", "filter.x.clean", "hook:pre-commit"]);
        assert!(findings[0].display.contains("touch /tmp/pwned"));
        assert!(find_findings(&[entry("global", "core.fsmonitor", "x")], &[]).is_empty());
    }

    #[test]
    fn findings_are_deduplicated_keeping_first_appearance_order() {
        // Khoá đa trị (`core.fsmonitor` đặt hai lần giống hệt, hoặc cùng giá trị ở hai file include) cho ra cùng một dòng hiển thị:
        // giao diện dùng dòng đó làm khoá `{#each}` nên trùng sẽ làm đứng cả hộp thoại tin tưởng.
        let entries = vec![
            entry("local", "core.fsmonitor", "touch /tmp/pwned"),
            entry("local", "filter.x.clean", "evil"),
            entry("local", "core.fsmonitor", "touch /tmp/pwned"),
            entry("worktree", "core.fsmonitor", "touch /tmp/pwned"),
            entry("local", "filter.x.clean", "evil"),
        ];
        let hooks = vec![HookFile { name: "pre-commit".into(), digest: "a".into() }, HookFile { name: "pre-commit".into(), digest: "b".into() }];
        let findings = find_findings(&entries, &hooks);
        let shown: Vec<_> = findings.iter().map(|f| f.display.as_str()).collect();
        assert_eq!(
            shown,
            [
                "core.fsmonitor = touch /tmp/pwned  (local, file:.git/config)",
                "filter.x.clean = evil  (local, file:.git/config)",
                "core.fsmonitor = touch /tmp/pwned  (worktree, file:.git/config)",
                "hook: pre-commit",
            ]
        );
        let unique: BTreeSet<_> = shown.iter().collect();
        assert_eq!(unique.len(), shown.len());
    }

    #[test]
    fn findings_hash_changes_with_values_and_hooks_but_not_order() {
        let a = vec![entry("local", "core.fsmonitor", "one"), entry("local", "core.sshcommand", "two")];
        let b = vec![entry("local", "core.sshcommand", "two"), entry("local", "core.fsmonitor", "one")];
        let hook = HookFile { name: "pre-commit".into(), digest: "d1".into() };
        assert_eq!(findings_hash(&a, &[]), findings_hash(&b, &[]));
        assert_ne!(findings_hash(&a, &[]), findings_hash(&a, std::slice::from_ref(&hook)));
        let changed = vec![entry("local", "core.fsmonitor", "other"), entry("local", "core.sshcommand", "two")];
        assert_ne!(findings_hash(&a, &[]), findings_hash(&changed, &[]));
        let edited = HookFile { name: "pre-commit".into(), digest: "d2".into() };
        assert_ne!(findings_hash(&a, std::slice::from_ref(&hook)), findings_hash(&a, &[edited]));
        // Mục không liên quan (người dùng tự đặt) không ảnh hưởng.
        let mut with_noise = a.clone();
        with_noise.push(entry("local", "user.name", "x"));
        assert_eq!(findings_hash(&a, &[]), findings_hash(&with_noise, &[]));
    }

    #[test]
    fn restrictions_use_trusted_values_or_neutral_ones() {
        let entries = vec![
            entry("global", "core.sshcommand", "ssh -i ~/.ssh/mine"),
            entry("system", "credential.helper", "osxkeychain"),
            entry("global", "credential.https://github.com.helper", "!gh auth git-credential"),
            entry("global", "filter.lfs.clean", "git-lfs clean -- %f"),
            entry("local", "core.sshcommand", "touch /tmp/pwned"),
            entry("local", "core.askpass", "/tmp/evil"),
            entry("local", "core.gitproxy", "/tmp/proxy"),
            entry("local", "filter.lfs.clean", "evil clean"),
            entry("local", "filter.x.smudge", "evil smudge"),
            entry("local", "filter.x.process", "evil process"),
            entry("local", "diff.x.textconv", "evil"),
            entry("local", "diff.external", "evil"),
            entry("local", "merge.m.driver", "evil %A"),
            entry("local", "credential.helper", "!evil"),
            entry("local", "credential.https://x.helper", "!evil2"),
            entry("local", "gpg.program", "evil"),
            entry("local", "gpg.ssh.program", "evil"),
            entry("local", "remote.origin.vcs", "evil"),
            entry("local", "protocol.ext.allow", "always"),
            entry("local", "protocol.fd.allow", "always"),
            entry("local", "core.fsmonitor", "evil"),
            entry("local", "sequence.editor", "evil"),
            entry("local", "trailer.sign.cmd", "evil"),
            entry("local", "core.alternaterefscommand", "evil"),
            entry("local", "gpg.ssh.defaultkeycommand", "evil"),
            entry("local", "submodule.libs.update", "!evil"),
            entry("global", "sequence.editor", "my-editor"),
        ];
        let r = build_restrictions(&entries, Path::new("/data/empty-hooks"));
        let get = |key: &str| r.config.iter().filter(|(k, _)| k == key).map(|(_, v)| v.as_str()).collect::<Vec<_>>();
        assert_eq!(get("core.hooksPath"), ["/data/empty-hooks"]);
        assert_eq!(get("core.sshcommand"), ["ssh -i ~/.ssh/mine"], "giá trị của người dùng thắng giá trị của repo");
        assert_eq!(get("core.askpass"), [""]);
        assert_eq!(r.proxy_command.as_deref(), Some(""));
        assert_eq!(get("filter.lfs.clean"), ["git-lfs clean -- %f"]);
        assert_eq!(get("filter.x.smudge"), [""]);
        assert_eq!(get("filter.x.process"), [""]);
        assert_eq!(get("diff.x.textconv"), [""]);
        assert_eq!(get("diff.external"), [""]);
        assert_eq!(get("merge.m.driver"), ["false"]);
        assert_eq!(get("gpg.program"), ["gpg"]);
        assert_eq!(get("gpg.ssh.program"), ["ssh-keygen"]);
        assert_eq!(get("remote.origin.vcs"), [""]);
        assert_eq!(get("protocol.ext.allow"), ["never"]);
        assert_eq!(get("protocol.fd.allow"), ["user"]);
        // credential.helper: đặt lại, rồi thêm lại helper của người dùng/hệ thống theo thứ tự và đúng khoá.
        assert_eq!(get("credential.helper"), ["", "osxkeychain"]);
        assert_eq!(get("credential.https://github.com.helper"), ["!gh auth git-credential"]);
        assert!(get("credential.https://x.helper").is_empty());
        assert!(!r.blocks_network && !r.fail_closed);
        assert!(get("core.fsmonitor").is_empty(), "đã có -c core.fsmonitor=false");
        assert_eq!(get("sequence.editor"), ["my-editor"], "giá trị của người dùng thắng");
        assert_eq!(get("trailer.sign.cmd"), ["false"]);
        assert_eq!(get("core.alternaterefscommand"), ["true"]);
        assert_eq!(get("gpg.ssh.defaultkeycommand"), ["false"]);
        assert_eq!(get("submodule.libs.update"), ["checkout"]);
    }

    #[test]
    fn first_wins_and_unoverridable_keys_cannot_be_neutralised_so_they_block_network() {
        for key in ["url.https://evil/.insteadof", "include.path", "includeif.gitdir:/x/.path", "remote.origin.uploadpack", "remote.origin.receivepack"] {
            let r = build_restrictions(&[entry("local", key, "x")], Path::new("/h"));
            assert!(r.blocks_network, "{key}");
        }
        assert!(!build_restrictions(&[entry("global", "include.path", "x")], Path::new("/h")).blocks_network);
    }

    fn entry_at(scope: &str, origin: &str, key: &str, value: &str) -> ConfigEntry {
        ConfigEntry { scope: scope.into(), origin: origin.into(), key: key.into(), value: value.into() }
    }

    #[test]
    fn include_keys_and_untrackable_origins_make_the_repo_fail_closed() {
        let hooks = Path::new("/h");
        for key in ["include.path", "includeif.onbranch:feat.path", "includeif.gitdir:/x/.path", "includeif.hasconfig:remote.*.url:https://x/**.path"] {
            let r = build_restrictions(&[entry("local", key, "../seed.inc")], hooks);
            assert!(r.fail_closed && r.blocks_network, "{key}");
            // kể cả include nằm trong config worktree
            assert!(build_restrictions(&[entry("worktree", key, "x")], hooks).fail_closed, "{key}");
        }
        // Include của người dùng (global/system) không phải do repo kiểm soát.
        assert!(!build_restrictions(&[entry("global", "include.path", "~/.gitconfig.d/work")], hooks).fail_closed);
        // Nguồn không phải file mà không theo dõi được thay đổi.
        for origin in ["blob:0123abcd", "standard input:", "command line:"] {
            let r = build_restrictions(&[entry_at("local", origin, "core.filemode", "true")], hooks);
            assert!(r.fail_closed && r.blocks_network, "{origin}");
        }
        // Cấu hình thường (kể cả khoá chạy lệnh vô hiệu hoá được) không làm fail-closed.
        let plain = build_restrictions(&[entry("local", "core.sshcommand", "evil"), entry("local", "user.name", "x")], hooks);
        assert!(!plain.fail_closed && !plain.blocks_network);
    }

    #[test]
    fn gpg_programs_are_pinned_even_when_the_scan_saw_no_such_key() {
        // Khoá có thể nằm trong file include đổi theo nhánh nên không thể chờ lần quét thấy rồi mới ghim.
        let r = build_restrictions(&[], Path::new("/h"));
        let get = |key: &str| r.config.iter().filter(|(k, _)| k == key).map(|(_, v)| v.as_str()).collect::<Vec<_>>();
        assert_eq!(get("gpg.program"), ["gpg"]);
        assert_eq!(get("gpg.openpgp.program"), ["gpg"]);
        assert_eq!(get("gpg.x509.program"), ["gpgsm"]);
        assert_eq!(get("gpg.ssh.program"), ["ssh-keygen"]);
        // Giá trị của người dùng thắng; `gpg.program` và `gpg.openpgp.program` là một biến nên cùng giá trị.
        let r = build_restrictions(
            &[entry("global", "gpg.program", "/opt/gpg2"), entry("local", "gpg.program", "evil"), entry("local", "gpg.ssh.program", "evil")],
            Path::new("/h"),
        );
        let get = |key: &str| r.config.iter().filter(|(k, _)| k == key).map(|(_, v)| v.as_str()).collect::<Vec<_>>();
        assert_eq!(get("gpg.program"), ["/opt/gpg2"]);
        assert_eq!(get("gpg.openpgp.program"), ["/opt/gpg2"]);
        assert_eq!(get("gpg.ssh.program"), ["ssh-keygen"]);
    }

    #[cfg(unix)]
    #[test]
    fn config_files_lists_every_file_origin_and_every_include_target() {
        let entries = vec![
            entry_at("system", "file:/etc/gitconfig", "core.x", "1"),
            entry_at("global", "file:/home/u/.gitconfig", "user.name", "u"),
            entry_at("local", "file:.git/config", "include.path", "../seed.inc"),
            entry_at("local", "file:.git/../seed.inc", "x.a", "1"),
            entry_at("local", "file:.git/config", "includeif.onbranch:feat.path", "/abs/static.inc"),
            entry_at("local", "file:.git/config", "includeif.gitdir:/x/.path", "missing.inc"),
            entry_at("command", "command line:", "core.hookspath", "/e"),
            entry_at("local", "blob:abc", "core.y", "2"),
        ];
        let files = config_files(&entries, Path::new("/repo"));
        let expected: Vec<PathBuf> = [
            "/abs/static.inc",
            "/etc/gitconfig",
            "/home/u/.gitconfig",
            "/repo/.git/../seed.inc",
            "/repo/.git/config",
            "/repo/.git/missing.inc",
        ]
        .iter()
        .map(PathBuf::from)
        .collect();
        assert_eq!(files, expected, "gồm cả đích include chưa tồn tại (`missing.inc`), không gồm nguồn không phải file");
    }

    #[test]
    fn restriction_env_uses_the_unambiguous_config_env_protocol() {
        let r = Restrictions {
            config: vec![("filter.a=b.clean".into(), "".into()), ("core.hooksPath".into(), "/h".into())],
            proxy_command: Some(String::new()),
            ..Restrictions::default()
        };
        let env: BTreeMap<_, _> = r.env().into_iter().collect();
        assert_eq!(env["GIT_CONFIG_COUNT"], "2");
        assert_eq!(env["GIT_CONFIG_KEY_0"], "filter.a=b.clean");
        assert_eq!(env["GIT_CONFIG_VALUE_0"], "");
        assert_eq!(env["GIT_CONFIG_KEY_1"], "core.hooksPath");
        assert_eq!(env["GIT_PROXY_COMMAND"], "");
    }

    #[test]
    fn finds_non_sample_hooks_only() {
        let dir = tempfile::tempdir().unwrap();
        let hooks = dir.path().join("hooks");
        std::fs::create_dir(&hooks).unwrap();
        std::fs::write(hooks.join("pre-commit.sample"), b"#!/bin/sh\n").unwrap();
        std::fs::write(hooks.join("pre-commit"), b"#!/bin/sh\necho hi\n").unwrap();
        std::fs::create_dir(hooks.join("nested")).unwrap();
        let found = read_hooks(dir.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "pre-commit");
        std::fs::write(hooks.join("pre-commit"), b"#!/bin/sh\necho changed\n").unwrap();
        assert_ne!(read_hooks(dir.path())[0].digest, found[0].digest);
        assert!(read_hooks(&dir.path().join("none")).is_empty());
    }

    #[test]
    fn trust_store_persists_and_requires_the_same_hash() {
        let dir = tempfile::tempdir().unwrap();
        let store = TrustStore::new(dir.path());
        assert!(!store.is_trusted("/repo", "h1"));
        store.trust("/repo", "h1").unwrap();
        assert!(store.is_trusted("/repo", "h1"));
        assert!(!store.is_trusted("/repo", "h2"), "tập khoá đổi → hỏi lại");
        assert!(!store.is_trusted("/other", "h1"));
        let reloaded = TrustStore::new(dir.path());
        assert!(reloaded.is_trusted("/repo", "h1"));
    }
}
