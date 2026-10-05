//! Minimal, policy-driven OS integration: open a terminal / editor at a repo, reveal it in Finder/Explorer, open a URL.
//! Paths only ever come from a registered repo (the repo root, or a relative file that passed the RepoFs scope check);
//! `open_url` only accepts `https:` (`mailto:` needs a confirmed flag), and `.cmd`/`.bat` are never run on Windows
//! (BatBadBut).

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::core::Core;
use crate::errors::{AppError, Result};
use crate::repo_fs::resolve_worktree;

const MAX_URL_LEN: usize = 2048;

/// One way to launch an external app (tried in order until one succeeds).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Launch {
    pub program: OsString,
    pub args: Vec<OsString>,
    /// Windows: the argument is passed verbatim (no quoting) — only for `explorer /select,"path"`.
    pub raw_args: Vec<OsString>,
    pub cwd: Option<PathBuf>,
    /// Wait for the exit code (macOS `open -b`: a non-zero code means the app does not exist).
    pub wait: bool,
    /// Windows: a console app needs its own console window.
    pub new_console: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Mac,
    Windows,
    Other,
}

pub fn current_os() -> Os {
    if cfg!(target_os = "macos") {
        Os::Mac
    } else if cfg!(windows) {
        Os::Windows
    } else {
        Os::Other
    }
}

/// Windows environment info used to build a plan (factored out for tests, so the registry is never read outside `cfg(windows)`).
#[derive(Debug, Clone, Default)]
pub struct WindowsEnv {
    pub local_app_data: Option<PathBuf>,
    pub program_files: Option<PathBuf>,
    /// `%SystemRoot%` (usually `C:\Windows`): the root of system programs that must be launched by absolute path.
    pub system_root: Option<PathBuf>,
    /// The registry's `App Paths` results: exe name → full path.
    pub app_paths: Vec<(String, PathBuf)>,
}

const MAC_TERMINALS: [&str; 4] = ["com.mitchellh.ghostty", "com.googlecode.iterm2", "dev.warp.Warp-Stable", "com.apple.Terminal"];
const MAC_EDITORS: [&str; 4] = ["com.microsoft.VSCode", "com.todesktop.230313mzl4w4u92", "dev.zed.Zed", "com.sublimetext.4"];

/// An exe that can be run directly: has an `.exe` extension, is not a `.cmd`/`.bat`/`.ps1` script…
pub fn is_launchable_exe(path: &Path) -> bool {
    path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
}

fn windows_editor_exes(env: &WindowsEnv) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = Vec::new();
    for name in ["Code.exe", "Cursor.exe", "Zed.exe", "sublime_text.exe"] {
        if let Some((_, path)) = env.app_paths.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)) {
            found.push(path.clone());
        }
    }
    if let Some(local) = &env.local_app_data {
        found.push(local.join("Programs/Microsoft VS Code/Code.exe"));
        found.push(local.join("Programs/cursor/Cursor.exe"));
        found.push(local.join("Programs/Zed/Zed.exe"));
    }
    if let Some(files) = &env.program_files {
        found.push(files.join("Microsoft VS Code/Code.exe"));
        found.push(files.join("Sublime Text/sublime_text.exe"));
    }
    found.retain(|p| is_launchable_exe(p));
    found
}

/// Join Windows-style paths (`\`) regardless of the host machine: the Windows plan must be buildable and testable on every OS.
fn win_join(base: &Path, tail: &str) -> OsString {
    format!(r"{}\{tail}", base.to_string_lossy().trim_end_matches(['\\', '/'])).into()
}

/// Terminal: on macOS try Ghostty → iTerm2 → Warp → Terminal (like the Swift app). On Windows every program runs by ABSOLUTE
/// path (a bare name must not be resolved via PATH or the current directory): `wt.exe` (an alias in
/// `%LOCALAPPDATA%\Microsoft\WindowsApps`) takes the folder through `-d` instead of the process CWD, then
/// PowerShell/cmd from System32 (no `-d` flag, so they use CWD = repo; because the exe path is absolute, the CWD does not
/// affect finding it).
pub fn terminal_plan(os: Os, root: &Path, win: &WindowsEnv) -> Vec<Launch> {
    match os {
        Os::Mac => MAC_TERMINALS
            .iter()
            .map(|id| Launch { program: "open".into(), args: vec!["-b".into(), (*id).into(), root.into()], wait: true, ..Launch::default() })
            .collect(),
        Os::Windows => {
            let mut plan = Vec::new();
            // `;` is wt's command separator and its docs do not say how to escape it inside the `-d` argument: skip wt for a folder containing `;`.
            if let Some(local) = &win.local_app_data
                && !root.to_string_lossy().contains(';')
            {
                plan.push(Launch { program: win_join(local, r"Microsoft\WindowsApps\wt.exe"), args: vec!["-d".into(), root.into()], ..Launch::default() });
            }
            if let Some(system) = &win.system_root {
                plan.push(Launch {
                    program: win_join(system, r"System32\WindowsPowerShell\v1.0\powershell.exe"),
                    args: vec!["-NoLogo".into(), "-NoExit".into()],
                    cwd: Some(root.to_path_buf()),
                    new_console: true,
                    ..Launch::default()
                });
                plan.push(Launch { program: win_join(system, r"System32\cmd.exe"), cwd: Some(root.to_path_buf()), new_console: true, ..Launch::default() });
            }
            plan
        }
        Os::Other => vec![Launch { program: "x-terminal-emulator".into(), cwd: Some(root.to_path_buf()), ..Launch::default() }],
    }
}

/// Editor: use the first one found (like Swift). A folder without an editor → open the file manager; a FILE is never opened
/// with the default app (a `.command`/`.app`/`.lnk` file from an untrusted repo could execute).
pub fn editor_plan(os: Os, target: &Path, is_dir: bool, win: &WindowsEnv) -> Vec<Launch> {
    let mut plan = match os {
        Os::Mac => MAC_EDITORS
            .iter()
            .map(|id| Launch { program: "open".into(), args: vec!["-b".into(), (*id).into(), target.into()], wait: true, ..Launch::default() })
            .collect(),
        Os::Windows => windows_editor_exes(win).into_iter().map(|exe| Launch { program: exe.into(), args: vec![target.into()], ..Launch::default() }).collect(),
        Os::Other => vec![Launch { program: "code".into(), args: vec![target.into()], ..Launch::default() }],
    };
    if is_dir {
        plan.push(reveal_plan(os, target, true));
    }
    plan
}

pub fn reveal_plan(os: Os, target: &Path, is_dir: bool) -> Launch {
    match os {
        Os::Mac => Launch { program: "open".into(), args: if is_dir { vec![target.into()] } else { vec!["-R".into(), target.into()] }, wait: true, ..Launch::default() },
        Os::Windows => {
            // Windows forbids `"` in file names, so verbatim quoting is safe.
            let quoted = format!("\"{}\"", target.display());
            let raw: OsString = if is_dir { quoted.into() } else { format!("/select,{quoted}").into() };
            Launch { program: "explorer.exe".into(), raw_args: vec![raw], ..Launch::default() }
        }
        Os::Other => Launch { program: "xdg-open".into(), args: vec![if is_dir { target.into() } else { target.parent().unwrap_or(target).into() }], ..Launch::default() },
    }
}

/// `open_url`: only `https:` (no credentials); `mailto:` only after the user confirmed it in the UI.
pub fn validate_open_url(raw: &str, mailto_confirmed: bool) -> Result<String> {
    if raw.is_empty() || raw.len() > MAX_URL_LEN || raw.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(AppError::policy("URL rỗng, quá dài hoặc chứa khoảng trắng/ký tự điều khiển"));
    }
    let url = url::Url::parse(raw).map_err(|e| AppError::policy(format!("URL không hợp lệ: {e}")))?;
    match url.scheme() {
        "https" => {
            if url.host_str().is_none_or(str::is_empty) {
                return Err(AppError::policy("URL thiếu tên miền"));
            }
            if !url.username().is_empty() || url.password().is_some() {
                return Err(AppError::policy("URL chứa thông tin đăng nhập (dễ giả mạo tên miền) nên bị chặn"));
            }
            Ok(url.to_string())
        }
        "mailto" if mailto_confirmed => Ok(url.to_string()),
        "mailto" => Err(AppError::policy("mailto: cần người dùng xác nhận trước khi mở")),
        other => Err(AppError::policy(format!("chỉ mở được URL https:, không mở `{other}:`"))),
    }
}

pub fn url_plan(os: Os, url: &str) -> Launch {
    match os {
        Os::Mac => Launch { program: "open".into(), args: vec![url.into()], wait: true, ..Launch::default() },
        // `explorer.exe <url>` opens the default browser without going through a shell (so `&` in the URL is not interpreted).
        Os::Windows => Launch { program: "explorer.exe".into(), args: vec![url.into()], ..Launch::default() },
        Os::Other => Launch { program: "xdg-open".into(), args: vec![url.into()], ..Launch::default() },
    }
}

/// The Windows environment. `with_registry` reads `App Paths` (a few `reg.exe` calls) — only needed when looking for an editor.
#[cfg(windows)]
fn windows_env(with_registry: bool) -> WindowsEnv {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let system_root = std::env::var_os("SystemRoot").or_else(|| std::env::var_os("windir")).map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let mut app_paths = Vec::new();
    if with_registry {
        let reg = PathBuf::from(win_join(&system_root, r"System32\reg.exe"));
        for name in ["Code.exe", "Cursor.exe", "Zed.exe", "sublime_text.exe"] {
            for hive in ["HKCU", "HKLM"] {
                let key = format!(r"{hive}\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{name}");
                let output = std::process::Command::new(&reg).args(["query", &key, "/ve"]).creation_flags(CREATE_NO_WINDOW).output();
                if let Ok(output) = output
                    && let Some(path) = parse_reg_default(&String::from_utf8_lossy(&output.stdout))
                {
                    app_paths.push((name.to_string(), path));
                    break;
                }
            }
        }
    }
    WindowsEnv {
        local_app_data: std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
        program_files: std::env::var_os("ProgramFiles").map(PathBuf::from),
        system_root: Some(system_root),
        app_paths,
    }
}

#[cfg(not(windows))]
fn windows_env(_with_registry: bool) -> WindowsEnv {
    WindowsEnv::default()
}

/// The default value in `reg query <key> /ve` output: `    (Default)    REG_SZ    C:\...\Code.exe`.
pub fn parse_reg_default(output: &str) -> Option<PathBuf> {
    output.lines().find_map(|line| {
        let (_, value) = line.split_once("REG_SZ")?;
        let value = value.trim().trim_matches('"');
        (!value.is_empty()).then(|| PathBuf::from(value))
    })
}

async fn run_launch(launch: &Launch) -> bool {
    let mut command = tokio::process::Command::new(&launch.program);
    command.args(&launch.args);
    if let Some(cwd) = &launch.cwd {
        command.current_dir(cwd);
    }
    command.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        for raw in &launch.raw_args {
            command.raw_arg(raw);
        }
        command.creation_flags(if launch.new_console { CREATE_NEW_CONSOLE } else { CREATE_NO_WINDOW });
    }
    if launch.wait {
        return matches!(tokio::time::timeout(Duration::from_secs(8), command.status()).await, Ok(Ok(status)) if status.success());
    }
    command.kill_on_drop(false).spawn().is_ok()
}

async fn run_first(plan: &[Launch], what: &str) -> Result<()> {
    for launch in plan {
        if run_launch(launch).await {
            return Ok(());
        }
    }
    Err(AppError::NotFound(format!("Không tìm thấy ứng dụng để {what}")))
}

impl Core {
    pub async fn open_in_terminal(&self, repo_id: &str) -> Result<()> {
        let entry = self.registry.get(repo_id)?;
        run_first(&terminal_plan(current_os(), &entry.root, &windows_env(false)), "mở terminal").await
    }

    /// `rel` (optional) is a relative file in the repo (scope-checked, must exist); without it → the root folder.
    pub async fn open_in_editor(&self, repo_id: &str, rel: Option<&str>) -> Result<()> {
        let entry = self.registry.get(repo_id)?;
        let (target, is_dir) = scoped_target(&entry, rel)?;
        run_first(&editor_plan(current_os(), &target, is_dir, &windows_env(true)), "mở trình soạn thảo").await
    }

    pub async fn reveal(&self, repo_id: &str, rel: Option<&str>) -> Result<()> {
        let entry = self.registry.get(repo_id)?;
        let (target, is_dir) = scoped_target(&entry, rel)?;
        run_first(&[reveal_plan(current_os(), &target, is_dir)], "hiện trong trình quản lý file").await
    }
}

fn scoped_target(entry: &crate::registry::RepoEntry, rel: Option<&str>) -> Result<(PathBuf, bool)> {
    let Some(rel) = rel else { return Ok((entry.root.clone(), true)) };
    let path = resolve_worktree(entry, rel)?;
    let metadata = std::fs::metadata(&path).map_err(|e| AppError::io(&format!("`{rel}`"), &e))?;
    Ok((path, metadata.is_dir()))
}

/// `open_url`: validate, then open with the default app.
pub async fn open_url(url: &str, mailto_confirmed: bool) -> Result<()> {
    let checked = validate_open_url(url, mailto_confirmed)?;
    run_first(&[url_plan(current_os(), &checked)], "mở liên kết").await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{TestRepo, core_with, open};

    #[test]
    fn open_url_accepts_https_only_and_confirmed_mailto() {
        for ok in ["https://github.com/HoangThai18/thaigit", "https://example.com:8443/a?b=c&d=e#f", "HTTPS://Example.COM/x"] {
            assert!(validate_open_url(ok, false).is_ok(), "{ok}");
        }
        assert_eq!(validate_open_url("https://example.com/a b", false).unwrap_err().code(), "policy");
        assert!(validate_open_url("mailto:me@example.com", true).is_ok());
        for bad in [
            "http://example.com", "file:///etc/passwd", "file://attacker/share", "javascript:alert(1)", "search-ms:query=x&crumb=location:\\\\attacker\\share",
            "ms-msdt:/id", "data:text/html,<script>", "ftp://example.com", "ssh://host/x", "tauri://localhost", "//example.com", "example.com",
            "https://user:pass@example.com", "https://github.com%2F@evil.example/x", "https://", "", "mailto:me@example.com",
            "https://example.com/\nfoo", "https://example.com/\0", "-https://example.com", "\\\\attacker\\share\\x",
        ] {
            assert_eq!(validate_open_url(bad, false).unwrap_err().code(), "policy", "{bad:?}");
        }
        assert_eq!(validate_open_url(&format!("https://e.com/{}", "a".repeat(MAX_URL_LEN)), false).unwrap_err().code(), "policy");
    }

    #[test]
    fn mac_plans_follow_the_swift_app_order() {
        let plan = terminal_plan(Os::Mac, Path::new("/Users/a/repo"), &WindowsEnv::default());
        let ids: Vec<_> = plan.iter().map(|l| l.args[1].to_string_lossy().into_owned()).collect();
        assert_eq!(ids, ["com.mitchellh.ghostty", "com.googlecode.iterm2", "dev.warp.Warp-Stable", "com.apple.Terminal"]);
        assert!(plan.iter().all(|l| l.program == "open" && l.wait && l.args[0] == "-b"));
        let editors = editor_plan(Os::Mac, Path::new("/Users/a/repo/src/x.rs"), false, &WindowsEnv::default());
        assert_eq!(editors.len(), 4, "file không có phương án dự phòng mở bằng ứng dụng mặc định");
        assert_eq!(editors[0].args[1], "com.microsoft.VSCode");
        let dir_plan = editor_plan(Os::Mac, Path::new("/Users/a/repo"), true, &WindowsEnv::default());
        assert_eq!(dir_plan.len(), 5);
        assert_eq!(dir_plan[4].args, [OsString::from("/Users/a/repo")]);
        assert_eq!(reveal_plan(Os::Mac, Path::new("/Users/a/repo/x"), false).args, ["-R", "/Users/a/repo/x"]);
        assert_eq!(url_plan(Os::Mac, "https://x.dev/").args, ["https://x.dev/"]);
    }

    fn windows_fixture() -> WindowsEnv {
        WindowsEnv {
            local_app_data: Some(PathBuf::from(r"C:\Users\a\AppData\Local")),
            program_files: Some(PathBuf::from(r"C:\Program Files")),
            system_root: Some(PathBuf::from(r"C:\Windows")),
            app_paths: vec![
                ("Code.exe".into(), PathBuf::from(r"C:\Users\a\AppData\Local\Programs\Microsoft VS Code\Code.exe")),
                ("sublime_text.exe".into(), PathBuf::from(r"C:\Tools\subl.cmd")),
                ("Zed.exe".into(), PathBuf::from(r"C:\Tools\zed.bat")),
            ],
        }
    }

    #[test]
    fn windows_editor_plan_never_launches_cmd_or_bat() {
        let plan = editor_plan(Os::Windows, Path::new(r"C:\repo\a&calc&.md"), false, &windows_fixture());
        assert!(!plan.is_empty());
        for launch in &plan {
            assert!(is_launchable_exe(Path::new(&launch.program)), "{:?}", launch.program);
            assert_eq!(launch.args, [OsString::from(r"C:\repo\a&calc&.md")], "đường dẫn là MỘT đối số, không qua shell");
        }
        assert!(plan.iter().all(|l| !l.program.to_string_lossy().to_lowercase().ends_with(".cmd") && !l.program.to_string_lossy().to_lowercase().ends_with(".bat")));
        let reveal = reveal_plan(Os::Windows, Path::new(r"C:\repo\file one.txt"), false);
        assert_eq!(reveal.raw_args, [OsString::from(r#"/select,"C:\repo\file one.txt""#)]);
        assert_eq!(url_plan(Os::Windows, "https://x.dev/?a=1&b=2").program, "explorer.exe");
    }

    #[test]
    fn windows_terminal_plan_uses_absolute_programs_and_passes_the_folder_to_wt_with_d() {
        let root = Path::new(r"C:\Users\a\My Repo");
        let plan = terminal_plan(Os::Windows, root, &windows_fixture());
        let programs: Vec<String> = plan.iter().map(|l| l.program.to_string_lossy().into_owned()).collect();
        assert_eq!(
            programs,
            [
                r"C:\Users\a\AppData\Local\Microsoft\WindowsApps\wt.exe",
                r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
                r"C:\Windows\System32\cmd.exe",
            ],
            "không còn tên trần `wt.exe`/`powershell.exe`/`cmd.exe`"
        );
        // wt: the folder goes through `-d`, NOT through the process CWD.
        assert_eq!(plan[0].args, [OsString::from("-d"), OsString::from(root)]);
        assert_eq!(plan[0].cwd, None);
        // PowerShell/cmd have no `-d`: CWD = repo (and because they run by absolute path, the CWD does not affect finding them).
        assert!(plan[1..].iter().all(|l| l.cwd.as_deref() == Some(root) && l.new_console));
        for launch in &plan {
            assert!(
                launch.program.to_string_lossy().starts_with(r"C:\"),
                "{:?} phải là đường dẫn tuyệt đối",
                launch.program
            );
        }
        // A folder containing `;` (wt's command separator): skip wt, keep PowerShell/cmd.
        let semicolon = terminal_plan(Os::Windows, Path::new(r"C:\a;b\repo"), &windows_fixture());
        assert_eq!(semicolon.len(), 2);
        assert!(semicolon.iter().all(|l| !l.program.to_string_lossy().ends_with("wt.exe")));
        // Without %SystemRoot%/%LOCALAPPDATA% we do not invent paths.
        assert!(terminal_plan(Os::Windows, root, &WindowsEnv::default()).is_empty());
    }

    #[test]
    fn launchable_exe_rejects_scripts() {
        assert!(is_launchable_exe(Path::new(r"C:\x\Code.exe")));
        assert!(is_launchable_exe(Path::new(r"C:\x\CODE.EXE")));
        for bad in [r"C:\x\code.cmd", r"C:\x\run.bat", r"C:\x\a.ps1", r"C:\x\code", r"C:\x\a.exe.cmd", r"C:\x\a.com"] {
            assert!(!is_launchable_exe(Path::new(bad)), "{bad}");
        }
    }

    #[test]
    fn parses_registry_app_paths_output() {
        let out = "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Code.exe\r\n    (Default)    REG_SZ    C:\\Program Files\\Microsoft VS Code\\Code.exe\r\n";
        assert_eq!(parse_reg_default(out), Some(PathBuf::from(r"C:\Program Files\Microsoft VS Code\Code.exe")));
        assert_eq!(parse_reg_default("ERROR: The system was unable to find the specified registry key"), None);
    }

    #[tokio::test]
    async fn editor_and_reveal_targets_stay_inside_the_repo() {
        let repo = TestRepo::new();
        repo.write("src/a.rs", "x");
        repo.commit_all("init");
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        let id = &opened.repo_id;
        for bad in ["../outside", "/etc/passwd", ".git/hooks/pre-commit", ".git", "GIT~1/x"] {
            assert_eq!(core.open_in_editor(id, Some(bad)).await.unwrap_err().code(), "out-of-scope", "{bad}");
            assert_eq!(core.reveal(id, Some(bad)).await.unwrap_err().code(), "out-of-scope", "{bad}");
        }
        assert_eq!(core.open_in_editor(id, Some("khong-co.rs")).await.unwrap_err().code(), "not-found");
        assert_eq!(core.open_in_editor("khong-ton-tai", None).await.unwrap_err().code(), "not-found");
        assert_eq!(open_url("file:///etc/passwd", false).await.unwrap_err().code(), "policy");
    }
}
