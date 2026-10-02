//! Tìm git: cài đặt người dùng → PATH (macOS thêm PATH của login shell, tối đa 3 s) → thư mục dự phòng của chính sách
//! → `where.exe` (Windows); kiểm `git --version` và "sàn bảo mật" theo advisory. Rust là nguồn sự thật duy nhất cho đường
//! dẫn git: webview chỉ chọn được trong số ứng viên Rust tìm thấy hoặc file chọn qua hộp thoại native.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::errors::{AppError, Result};
use crate::policy::policy;
use crate::store;

/// Dưới mức này thiếu tính năng cần dùng (`--pathspec-from-file`, `switch`, `restore`).
pub const MIN_FEATURE_VERSION: (u32, u32, u32) = (2, 35, 0);

/// Ngày xem lại bảng sàn bảo mật gần nhất — xem lại mỗi lần phát hành (plan: Phase 2 "Sàn git bảo mật").
pub const FLOOR_TABLE_REVIEWED: &str = "2026-10-02";

/// Bản vá tối thiểu theo dòng (series) — gom từ các advisory git đến CVE-2025-48384/48385/48386 (07/2025), trước đó
/// CVE-2024-32002/32004/32020/32021/32465, CVE-2024-50349/52006 và CVE-2022-23521/41903 (clone/checkout/credential).
/// Dòng < 2.39 không còn bản vá nào → dưới sàn. Dòng ≤ 2.42 không có bản vá cho CVE-2025-48384 (chỉ ảnh hưởng
/// `clone --recurse-submodules`, thứ app không bao giờ chạy) nên 2.39.5 … 2.42.4 vẫn đạt sàn. Dòng > 2.50: chưa có advisory.
const SECURITY_FLOOR: &[((u32, u32), u32)] = &[
    ((2, 39), 5),
    ((2, 40), 4),
    ((2, 41), 3),
    ((2, 42), 4),
    ((2, 43), 7),
    ((2, 44), 4),
    ((2, 45), 4),
    ((2, 46), 4),
    ((2, 47), 3),
    ((2, 48), 2),
    ((2, 49), 1),
    ((2, 50), 1),
];

/// Git for Windows < 2.53.0.windows.2 lộ băm NTLM khi clone từ máy chủ lạ (CVE-2025-66413): chỉ cảnh báo, không chặn.
const WINDOWS_NTLM_FIX: (u32, u32, u32, u32) = (2, 53, 0, 2);

/// Phiên bản git đã tách từ `git --version`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    /// Số bản dựng Git for Windows (`2.47.1.windows.2` → `Some(2)`).
    pub windows_build: Option<u32>,
}

impl GitVersion {
    /// Tách từ output như `git version 2.54.0 (Apple Git-157)` hoặc `git version 2.47.1.windows.2`.
    pub fn parse(output: &str) -> Option<Self> {
        let rest = output.trim().strip_prefix("git version ")?;
        let token = rest.split_whitespace().next()?;
        let parts: Vec<&str> = token.split('.').collect();
        let number = |text: &str| -> Option<u32> {
            let digits: String = text.chars().take_while(char::is_ascii_digit).collect();
            digits.parse().ok()
        };
        let major = number(parts.first()?)?;
        let minor = number(parts.get(1)?)?;
        let patch = parts.get(2).and_then(|p| number(p)).unwrap_or(0);
        let windows_build = parts.iter().position(|p| *p == "windows").and_then(|i| parts.get(i + 1)).and_then(|p| number(p));
        Some(Self { major, minor, patch, windows_build })
    }

    pub fn tuple(&self) -> (u32, u32, u32) {
        (self.major, self.minor, self.patch)
    }

    pub fn dotted(&self) -> String {
        format!("{}.{}.{}", self.major, self.minor, self.patch)
    }
}

/// Kết quả so với sàn bảo mật.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FloorCheck {
    /// Dưới bản vá RCE/clone mới nhất của dòng → chặn clone/fetch/pull.
    pub below_floor: bool,
    pub minimum: Option<String>,
    pub warning: Option<String>,
}

pub fn check_floor(version: &GitVersion) -> FloorCheck {
    let tuple = version.tuple();
    let mut check = FloorCheck::default();
    if tuple < MIN_FEATURE_VERSION {
        check.below_floor = true;
        check.minimum = Some("2.39.5".into());
        check.warning = Some(format!(
            "Git {} quá cũ (thiếu tính năng cần thiết và nhiều bản vá bảo mật). Hãy cài git ≥ 2.50.1.",
            version.dotted()
        ));
        return check;
    }
    if (version.major, version.minor) < (2, 39) {
        check.below_floor = true;
        check.minimum = Some("2.39.5".into());
    } else if let Some(((_, _), min_patch)) =
        SECURITY_FLOOR.iter().find(|((major, minor), _)| (*major, *minor) == (version.major, version.minor))
        && version.patch < *min_patch
    {
        check.below_floor = true;
        check.minimum = Some(format!("{}.{}.{}", version.major, version.minor, min_patch));
    }
    if check.below_floor {
        let minimum = check.minimum.clone().unwrap_or_default();
        check.warning = Some(format!(
            "Git {} chưa có bản vá bảo mật clone/checkout (cần ≥ {minimum}). Thaigit chặn clone/fetch/pull cho tới khi bạn cập nhật git.",
            version.dotted()
        ));
    } else if let Some(build) = version.windows_build
        && (version.major, version.minor, version.patch, build) < WINDOWS_NTLM_FIX
    {
        check.warning = Some(format!(
            "Git for Windows {} có thể lộ băm NTLM khi clone từ máy chủ lạ (CVE-2025-66413) — nên cập nhật lên 2.53.0.windows.2 trở lên.",
            version.dotted()
        ));
    }
    check
}

/// Thông tin git gửi cho webview (`git_locate`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub path: String,
    /// Nguyên văn `git --version`, ví dụ `git version 2.54.0 (Apple Git-157)`.
    pub version: String,
    pub version_tuple: [u32; 3],
    /// `setting` | `path` | `fallback` | `where`.
    pub source: &'static str,
    pub too_old: bool,
    pub below_security_floor: bool,
    pub minimum_version: Option<String>,
    pub warning: Option<String>,
    pub login_shell_path_loaded: bool,
    /// Các git Rust tìm thấy — `set_git_path` chỉ nhận một trong số này.
    pub candidates: Vec<String>,
}

impl GitInfo {
    /// Subcommand mạng bị chặn khi git dưới sàn bảo mật.
    pub fn blocks(&self, sub: &str) -> bool {
        self.below_security_floor && matches!(sub, "clone" | "fetch" | "pull")
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    git_path: Option<String>,
}

#[derive(Default)]
struct State {
    setting: Option<PathBuf>,
    login_path: Option<String>,
    login_loaded: bool,
    info: Option<Arc<GitInfo>>,
    /// File git đã chọn qua hộp thoại native trong phiên này.
    picked: Vec<PathBuf>,
}

pub struct Locator {
    settings_path: PathBuf,
    state: RwLock<State>,
}

fn exe_name() -> &'static str {
    if cfg!(windows) { "git.exe" } else { "git" }
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
}

/// Git đầu tiên (file thực thi) trong các thư mục; không bao giờ nhận `.cmd`/`.bat`.
pub fn find_in_dirs(dirs: &[PathBuf]) -> Option<PathBuf> {
    dirs.iter().map(|dir| dir.join(exe_name())).find(|candidate| is_executable_file(candidate))
}

/// Gộp PATH như `GitEnvironment.make`: PATH login shell, PATH tiến trình, rồi thư mục dự phòng; bỏ trùng và rỗng.
pub fn merge_path(login_path: Option<&str>, process_path: Option<&OsString>, fallbacks: &[PathBuf]) -> Vec<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    let mut merged = Vec::new();
    let mut add = |dir: PathBuf| {
        if !dir.as_os_str().is_empty() && seen.insert(dir.clone()) {
            merged.push(dir);
        }
    };
    if let Some(login) = login_path {
        for dir in std::env::split_paths(login) {
            add(dir);
        }
    }
    if let Some(path) = process_path {
        for dir in std::env::split_paths(path) {
            add(dir);
        }
    }
    for dir in fallbacks {
        add(dir.clone());
    }
    merged
}

/// Thư mục dự phòng theo hệ điều hành (từ `git-policy.json`, thêm cài đặt per-user của Git for Windows).
pub fn fallback_dirs() -> Vec<PathBuf> {
    let fallback = &policy().env.path_fallback;
    let mut dirs: Vec<PathBuf> = if cfg!(windows) { &fallback.windows } else { &fallback.macos }
        .iter()
        .map(PathBuf::from)
        .collect();
    if cfg!(windows)
        && let Some(local) = std::env::var_os("LOCALAPPDATA")
    {
        dirs.push(PathBuf::from(local).join("Programs").join("Git").join("cmd"));
    }
    dirs
}

/// Output của `$SHELL -l -i -c "echo MARKER; /usr/bin/env"` → giá trị `PATH=`.
pub fn parse_login_shell_output(text: &str, marker: &str) -> Option<String> {
    let after = &text[text.find(marker)? + marker.len()..];
    after.lines().find_map(|line| {
        let value = line.strip_prefix("PATH=")?;
        (!value.is_empty()).then(|| value.to_string())
    })
}

/// Output của `where.exe git`: dòng đầu là file `.exe` (bỏ `.cmd`/`.bat`).
pub fn parse_where_output(text: &str) -> Option<PathBuf> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .find(|l| l.to_ascii_lowercase().ends_with(".exe"))
        .map(PathBuf::from)
}

#[cfg(target_os = "macos")]
const LOGIN_MARKER: &str = "__THAIGIT_ENV_BEGIN__";

/// PATH của login shell (macOS): app mở từ Finder/Dock chỉ có PATH tối thiểu nên thiếu Homebrew, gh, gpg….
#[cfg(target_os = "macos")]
async fn login_shell_path(timeout: Duration) -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut command = tokio::process::Command::new(shell);
    command
        .args(["-l", "-i", "-c", &format!("echo {LOGIN_MARKER}; /usr/bin/env")])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let output = tokio::time::timeout(timeout, command.output()).await.ok()?.ok()?;
    parse_login_shell_output(&String::from_utf8_lossy(&output.stdout), LOGIN_MARKER)
}

#[cfg(not(target_os = "macos"))]
async fn login_shell_path(_timeout: Duration) -> Option<String> {
    None
}

/// macOS: `/usr/bin/git` là shim của Apple — không có Command Line Tools thì chạy nó sẽ bật hộp thoại cài đặt.
#[cfg(target_os = "macos")]
async fn apple_git_usable() -> bool {
    tokio::process::Command::new("/usr/bin/xcode-select")
        .arg("-p")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .is_ok_and(|s| s.success())
}

#[cfg(not(target_os = "macos"))]
async fn apple_git_usable() -> bool {
    false
}

#[cfg(windows)]
async fn where_git() -> Option<PathBuf> {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut command = tokio::process::Command::new("where.exe");
    command.arg("git").creation_flags(CREATE_NO_WINDOW).stdin(std::process::Stdio::null()).kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(5), command.output()).await.ok()?.ok()?;
    parse_where_output(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(not(windows))]
async fn where_git() -> Option<PathBuf> {
    None
}

async fn run_version(git: &Path) -> Result<String> {
    let mut command = tokio::process::Command::new(git);
    command
        .arg("--version")
        .env_clear()
        .env("LC_ALL", "C")
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let output = tokio::time::timeout(Duration::from_secs(10), command.output())
        .await
        .map_err(|_| AppError::GitMissing(format!("`{} --version` không phản hồi", git.display())))?
        .map_err(|e| AppError::GitMissing(format!("Không chạy được {}: {e}", git.display())))?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if output.status.success() && GitVersion::parse(&text).is_some() {
        Ok(text)
    } else {
        Err(AppError::GitMissing(format!("{} không phải git hợp lệ", git.display())))
    }
}

impl Locator {
    pub fn new(data_dir: &Path) -> Self {
        let settings_path = data_dir.join("git-settings.json");
        let setting = store::read_json::<Settings>(&settings_path).and_then(|s| s.git_path).map(PathBuf::from);
        Self { settings_path, state: RwLock::new(State { setting, ..State::default() }) }
    }

    fn read(&self) -> std::sync::RwLockReadGuard<'_, State> {
        self.state.read().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn write(&self) -> std::sync::RwLockWriteGuard<'_, State> {
        self.state.write().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Git hiện tại (đã `refresh`); `git-missing` nếu chưa có.
    pub fn current(&self) -> Result<Arc<GitInfo>> {
        self.read().info.clone().ok_or_else(|| {
            AppError::GitMissing(
                "Không tìm thấy git. Hãy cài git (macOS: `xcode-select --install` hoặc `brew install git`; Windows: Git for Windows) rồi mở lại Thaigit.".into(),
            )
        })
    }

    /// Các thư mục tìm git: PATH login shell + PATH tiến trình + dự phòng.
    pub fn search_dirs(&self) -> Vec<PathBuf> {
        let login = self.read().login_path.clone();
        merge_path(login.as_deref(), std::env::var_os("PATH").as_ref(), &fallback_dirs())
    }

    /// PATH gộp, dùng làm `PATH` của mọi lệnh git.
    pub fn path_env(&self) -> OsString {
        std::env::join_paths(self.search_dirs()).unwrap_or_default()
    }

    /// Nạp PATH của login shell (macOS) rồi tìm lại git; phát tín hiệu qua giá trị trả về `true` nếu đổi.
    pub async fn load_login_path(&self, timeout: Duration) -> bool {
        let path = login_shell_path(timeout).await;
        {
            let mut state = self.write();
            state.login_loaded = true;
            if path.is_none() || state.login_path == path {
                return false;
            }
            state.login_path = path;
        }
        self.refresh().await.is_ok()
    }

    /// Tìm git theo thứ tự ưu tiên và nạp `git --version`.
    pub async fn refresh(&self) -> Result<Arc<GitInfo>> {
        let setting = self.read().setting.clone();
        let dirs = self.search_dirs();
        let mut candidates: Vec<(PathBuf, &'static str)> = Vec::new();
        if let Some(path) = setting.filter(|p| is_executable_file(p)) {
            candidates.push((path, "setting"));
        }
        // Chỉ macOS: `/usr/bin/git` là shim của Apple, thử sau cùng và chỉ khi có Command Line Tools.
        let apple = PathBuf::from("/usr/bin");
        let (apple_dirs, other_dirs): (Vec<_>, Vec<_>) =
            if cfg!(target_os = "macos") { dirs.iter().cloned().partition(|d| *d == apple) } else { (Vec::new(), dirs.clone()) };
        let fallbacks = fallback_dirs();
        for dir in &other_dirs {
            if let Some(found) = find_in_dirs(std::slice::from_ref(dir)) {
                let source = if fallbacks.contains(dir) { "fallback" } else { "path" };
                if !candidates.iter().any(|(p, _)| *p == found) {
                    candidates.push((found, source));
                }
            }
        }
        if cfg!(windows)
            && candidates.is_empty()
            && let Some(found) = where_git().await
        {
            candidates.push((found, "where"));
        }
        if candidates.is_empty()
            && !apple_dirs.is_empty()
            && cfg!(target_os = "macos")
            && apple_git_usable().await
            && let Some(found) = find_in_dirs(&apple_dirs)
        {
            candidates.push((found, "path"));
        }
        let Some((path, source)) = candidates.first().cloned() else {
            self.write().info = None;
            return Err(self.current().err().unwrap_or_else(|| AppError::GitMissing("Không tìm thấy git".into())));
        };
        let version_text = run_version(&path).await?;
        let version = GitVersion::parse(&version_text)
            .ok_or_else(|| AppError::GitMissing(format!("Không đọc được phiên bản git: {version_text}")))?;
        let floor = check_floor(&version);
        let login_loaded = self.read().login_loaded;
        let info = Arc::new(GitInfo {
            path: path.to_string_lossy().into_owned(),
            version: version_text,
            version_tuple: [version.major, version.minor, version.patch],
            source,
            too_old: version.tuple() < MIN_FEATURE_VERSION,
            below_security_floor: floor.below_floor,
            minimum_version: floor.minimum,
            warning: floor.warning,
            login_shell_path_loaded: login_loaded,
            candidates: candidates.iter().map(|(p, _)| p.to_string_lossy().into_owned()).collect(),
        });
        self.write().info = Some(info.clone());
        Ok(info)
    }

    /// `set_git_path`: `None` = tự tìm; `Some` phải là ứng viên Rust tìm thấy hoặc file đã chọn qua hộp thoại native.
    pub async fn set_path(&self, requested: Option<&str>) -> Result<Arc<GitInfo>> {
        let new_setting = match requested {
            None => None,
            Some(text) => {
                let path = PathBuf::from(text);
                let allowed = {
                    let state = self.read();
                    state.picked.contains(&path)
                        || state.info.as_ref().is_some_and(|i| i.candidates.iter().any(|c| Path::new(c) == path))
                };
                if !allowed {
                    return Err(AppError::policy(
                        "đường dẫn git phải là một ứng viên Thaigit tìm thấy hoặc chọn bằng hộp thoại hệ thống",
                    ));
                }
                Some(path)
            }
        };
        let previous = std::mem::replace(&mut self.write().setting, new_setting.clone());
        match self.refresh().await {
            Ok(info) => {
                let settings = Settings { git_path: new_setting.map(|p| p.to_string_lossy().into_owned()) };
                store::write_json(&self.settings_path, &settings)?;
                Ok(info)
            }
            Err(error) => {
                self.write().setting = previous;
                let _ = self.refresh().await;
                Err(error)
            }
        }
    }

    /// Chọn git bằng hộp thoại native: kiểm `--version` rồi áp dụng.
    pub async fn set_picked(&self, path: PathBuf) -> Result<Arc<GitInfo>> {
        if cfg!(windows) && !is_executable_file(&path) {
            return Err(AppError::policy("chỉ nhận file .exe (không chạy .cmd/.bat)"));
        }
        run_version(&path).await?;
        self.write().picked.push(path.clone());
        self.set_path(Some(&path.to_string_lossy())).await
    }

    pub fn login_loaded(&self) -> bool {
        self.read().login_loaded
    }

    /// Dựng bộ định vị với git cố định (test).
    #[cfg(test)]
    pub async fn with_fixed_git(data_dir: &Path, git: &Path) -> Arc<Self> {
        let locator = Arc::new(Self::new(data_dir));
        locator.write().picked.push(git.to_path_buf());
        locator.write().setting = Some(git.to_path_buf());
        locator.refresh().await.expect("git thật để test");
        locator
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_real_world_version_strings() {
        let apple = GitVersion::parse("git version 2.54.0 (Apple Git-157)\n").unwrap();
        assert_eq!(apple.tuple(), (2, 54, 0));
        assert_eq!(apple.windows_build, None);
        let windows = GitVersion::parse("git version 2.47.1.windows.2").unwrap();
        assert_eq!((windows.tuple(), windows.windows_build), ((2, 47, 1), Some(2)));
        let rc = GitVersion::parse("git version 2.55.0-rc1").unwrap();
        assert_eq!(rc.tuple(), (2, 55, 0));
        let short = GitVersion::parse("git version 2.39").unwrap();
        assert_eq!(short.tuple(), (2, 39, 0));
        assert!(GitVersion::parse("hg version 1.0").is_none());
        assert!(GitVersion::parse("git version x.y").is_none());
        assert!(GitVersion::parse("").is_none());
    }

    fn floor(text: &str) -> FloorCheck {
        check_floor(&GitVersion::parse(&format!("git version {text}")).unwrap())
    }

    #[test]
    fn security_floor_per_series() {
        // CVE-2022-23521 và các CVE clone/checkout mới hơn: mỗi dòng cần bản vá mới nhất của nó.
        assert!(floor("2.35.5").below_floor);
        assert!(floor("2.38.9").below_floor, "dòng 2.38 không còn bản vá");
        assert!(floor("2.39.4").below_floor);
        assert!(!floor("2.39.5").below_floor);
        assert!(floor("2.43.6").below_floor);
        assert!(!floor("2.43.7").below_floor);
        assert!(floor("2.45.3").below_floor);
        assert!(!floor("2.45.4").below_floor);
        assert!(floor("2.49.0").below_floor);
        assert!(!floor("2.49.1").below_floor);
        assert!(floor("2.50.0").below_floor);
        assert!(!floor("2.50.1").below_floor);
        assert!(!floor("2.54.0").below_floor);
        assert_eq!(floor("2.45.3").minimum.as_deref(), Some("2.45.4"));
        assert!(floor("2.45.3").warning.unwrap().contains("2.45.4"));
    }

    #[test]
    fn too_old_for_features_is_below_the_floor_too() {
        let check = floor("2.30.9");
        assert!(check.below_floor);
        assert!(check.warning.is_some());
    }

    #[test]
    fn windows_ntlm_advisory_is_a_warning_not_a_block() {
        let old = floor("2.52.0.windows.1");
        assert!(!old.below_floor);
        assert!(old.warning.unwrap().contains("CVE-2025-66413"));
        assert!(floor("2.53.0.windows.1").warning.is_some());
        assert!(floor("2.53.0.windows.2").warning.is_none());
        assert!(floor("2.54.0.windows.1").warning.is_none());
        assert!(floor("2.54.0").warning.is_none(), "bản không phải Windows không bị cảnh báo NTLM");
    }

    #[test]
    fn blocks_only_clone_fetch_and_pull_below_the_floor() {
        let info = |below| GitInfo {
            path: String::new(),
            version: String::new(),
            version_tuple: [2, 45, 3],
            source: "path",
            too_old: false,
            below_security_floor: below,
            minimum_version: None,
            warning: None,
            login_shell_path_loaded: false,
            candidates: vec![],
        };
        for sub in ["clone", "fetch", "pull"] {
            assert!(info(true).blocks(sub));
            assert!(!info(false).blocks(sub));
        }
        assert!(!info(true).blocks("push"));
        assert!(!info(true).blocks("status"));
    }

    #[test]
    fn merge_path_orders_login_then_process_then_fallbacks_without_duplicates() {
        let process = OsString::from(if cfg!(windows) { "C:\\p;C:\\a" } else { "/p:/a:/q" });
        let fallbacks = vec![PathBuf::from(if cfg!(windows) { "C:\\q" } else { "/q" }), PathBuf::from(if cfg!(windows) { "C:\\z" } else { "/z" })];
        let login = if cfg!(windows) { "C:\\a;C:\\l" } else { "/a:/l" };
        let merged = merge_path(Some(login), Some(&process), &fallbacks);
        let expected: Vec<PathBuf> = if cfg!(windows) {
            ["C:\\a", "C:\\l", "C:\\p", "C:\\q", "C:\\z"].iter().map(PathBuf::from).collect()
        } else {
            ["/a", "/l", "/p", "/q", "/z"].iter().map(PathBuf::from).collect()
        };
        assert_eq!(merged, expected);
        assert!(merge_path(None, None, &[]).is_empty());
    }

    #[test]
    fn finds_git_in_the_first_directory_that_has_it() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let name = exe_name();
        std::fs::write(b.path().join(name), b"#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(b.path().join(name), std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let dirs = vec![a.path().to_path_buf(), b.path().to_path_buf()];
        assert_eq!(find_in_dirs(&dirs), Some(b.path().join(name)));
        assert_eq!(find_in_dirs(&dirs[..1]), None);
    }

    #[cfg(unix)]
    #[test]
    fn non_executable_git_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("git"), b"x").unwrap();
        assert_eq!(find_in_dirs(&[dir.path().to_path_buf()]), None);
    }

    #[test]
    fn parses_login_shell_output_after_the_marker() {
        let text = "Last login: x\nPATH=/ignored\n__M__\nHOME=/Users/a\nPATH=/opt/homebrew/bin:/usr/bin\nSHELL=/bin/zsh\n";
        assert_eq!(parse_login_shell_output(text, "__M__").as_deref(), Some("/opt/homebrew/bin:/usr/bin"));
        assert_eq!(parse_login_shell_output("no marker\nPATH=/x", "__M__"), None);
        assert_eq!(parse_login_shell_output("__M__\nPATH=\n", "__M__"), None);
    }

    #[test]
    fn where_output_skips_cmd_and_bat() {
        let text = "C:\\Program Files\\Git\\cmd\\git.cmd\r\nC:\\Program Files\\Git\\cmd\\git.exe\r\n";
        assert_eq!(parse_where_output(text), Some(PathBuf::from("C:\\Program Files\\Git\\cmd\\git.exe")));
        assert_eq!(parse_where_output("C:\\x\\git.bat\r\n"), None);
        assert_eq!(parse_where_output(""), None);
    }

    #[tokio::test]
    async fn locates_the_real_git_and_rejects_free_form_paths() {
        let dir = tempfile::tempdir().unwrap();
        let locator = Locator::new(dir.path());
        locator.load_login_path(Duration::from_secs(3)).await;
        let info = locator.refresh().await.expect("máy test phải có git");
        assert!(info.version.starts_with("git version "));
        assert!(!info.candidates.is_empty());
        // JS không được trỏ git tới file tuỳ ý.
        let error = locator.set_path(Some("/bin/sh")).await.unwrap_err();
        assert_eq!(error.code(), "policy");
        // Chọn một ứng viên Rust tìm thấy thì được, và lưu lại.
        let again = locator.set_path(Some(&info.path)).await.unwrap();
        assert_eq!(again.path, info.path);
        let reloaded = Locator::new(dir.path());
        assert_eq!(reloaded.read().setting.as_deref(), Some(Path::new(&info.path)));
        // Xoá cài đặt → tự tìm.
        assert!(locator.set_path(None).await.is_ok());
    }
}
