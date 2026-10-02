// Một số hàm chỉ dùng ở test chạy trên Unix.
#![allow(dead_code)]

//! Công cụ dùng chung cho test: repo git thật trong thư mục tạm, cô lập khỏi cấu hình/askpass của máy. Không bao giờ
//! chạm repo thật của người dùng.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use crate::core::{Core, GitExecRequest};
use crate::exec::CollectSink;
use crate::policy::ExecKind;
use crate::pathutil::canonical;
use crate::policy::EnvMap;
use crate::registry::{OpenSource, OpenedRepo};

/// Git của máy test (PATH, rồi các vị trí thường gặp).
pub fn system_git() -> PathBuf {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    dirs.extend(["/usr/bin", "/opt/homebrew/bin", "/usr/local/bin"].iter().map(PathBuf::from));
    crate::locate::find_in_dirs(&dirs).expect("máy chạy test phải có git")
}

/// Env gốc sạch: không có `GIT_ASKPASS`/`SSH_ASKPASS`/biến VS Code, cấu hình git toàn cục/hệ thống bị vô hiệu, HOME riêng.
pub fn clean_env(home: &Path) -> EnvMap {
    let mut env = EnvMap::default();
    let path = std::env::var_os("PATH").unwrap_or_else(|| OsString::from("/usr/bin:/bin"));
    env.set("PATH", path);
    env.set("HOME", home.as_os_str());
    env.set("USERPROFILE", home.as_os_str());
    env.set("XDG_CONFIG_HOME", home.join(".config").into_os_string());
    // Một file thật trong HOME tạm (không phải /dev/null) để `git config --global` ghi được mà không chạm máy thật.
    env.set("GIT_CONFIG_GLOBAL", home.join(".gitconfig").into_os_string());
    env.set("GIT_CONFIG_NOSYSTEM", "1");
    env.set("LANG", "en_US.UTF-8");
    env.set("GIT_TERMINAL_PROMPT", "0");
    if let Some(temp) = std::env::var_os("TMPDIR") {
        env.set("TMPDIR", temp);
    }
    if let Some(root) = std::env::var_os("SystemRoot") {
        env.set("SystemRoot", root);
    }
    env
}

pub struct TestRepo {
    dir: tempfile::TempDir,
    root: PathBuf,
    home: PathBuf,
    /// Thư mục đầu PATH để test đặt chương trình giả (vd. `git-remote-<vcs>`).
    bin: PathBuf,
}

impl TestRepo {
    pub fn new() -> Self {
        let dir = tempfile::tempdir().expect("thư mục tạm");
        let root = dir.path().join("repo");
        let home = dir.path().join("home");
        let bin = dir.path().join("bin");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&home).unwrap();
        std::fs::create_dir_all(&bin).unwrap();
        let repo = Self { dir, root, home, bin };
        repo.git(&["init", "-q", "-b", "main"]);
        repo.git(&["config", "user.name", "Thaigit Test"]);
        repo.git(&["config", "user.email", "test@example.com"]);
        repo.git(&["config", "commit.gpgsign", "false"]);
        repo
    }

    /// Đường dẫn đúng như `tempdir` trả về (trên macOS đi qua symlink `/var` → `/private/var`).
    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn symlinked_root(&self) -> PathBuf {
        self.root.clone()
    }

    pub fn canonical_root(&self) -> PathBuf {
        canonical(&self.root).unwrap()
    }

    pub fn home(&self) -> &Path {
        &self.home
    }

    pub fn tmp(&self) -> &Path {
        self.dir.path()
    }

    pub fn bin(&self) -> &Path {
        &self.bin
    }

    pub fn env(&self) -> EnvMap {
        let mut env = clean_env(&self.home);
        let mut dirs = vec![self.bin.clone()];
        if let Some(path) = env.get("PATH") {
            dirs.extend(std::env::split_paths(path));
        }
        env.set("PATH", std::env::join_paths(dirs).unwrap());
        env
    }

    pub fn command(&self, args: &[&str]) -> Command {
        let mut command = Command::new(system_git());
        command.args(args).current_dir(&self.root).env_clear().stdin(Stdio::null());
        for (key, value) in self.env().into_pairs() {
            command.env(key, value);
        }
        command
    }

    /// Chạy git (panic nếu thất bại), trả stdout.
    pub fn git(&self, args: &[&str]) -> String {
        let output = self.command(args).output().expect("chạy được git");
        assert!(output.status.success(), "git {args:?} thất bại: {}", String::from_utf8_lossy(&output.stderr));
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    /// Chạy git, trả (mã thoát, stdout, stderr) kể cả khi lỗi.
    pub fn git_raw(&self, args: &[&str]) -> (i32, String, String) {
        let output = self.command(args).output().expect("chạy được git");
        (
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stdout).into_owned(),
            String::from_utf8_lossy(&output.stderr).into_owned(),
        )
    }

    /// Chạy git với stdin, trả (mã thoát, stdout, stderr).
    pub fn git_stdin(&self, args: &[&str], stdin: &str) -> (i32, String, String) {
        use std::io::Write;
        let mut child = self.command(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().expect("chạy được git");
        child.stdin.take().unwrap().write_all(stdin.as_bytes()).unwrap();
        let output = child.wait_with_output().unwrap();
        (
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stdout).into_owned(),
            String::from_utf8_lossy(&output.stderr).into_owned(),
        )
    }

    pub fn write(&self, rel: &str, content: &str) {
        self.write_bytes(rel, content.as_bytes());
    }

    pub fn write_bytes(&self, rel: &str, content: &[u8]) {
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, content).unwrap();
    }

    pub fn read(&self, rel: &str) -> Vec<u8> {
        std::fs::read(self.root.join(rel)).unwrap()
    }

    pub fn commit_all(&self, message: &str) {
        self.git(&["add", "-A"]);
        self.git(&["commit", "-q", "-m", message]);
    }

    pub fn exists(&self, rel: &str) -> bool {
        self.root.join(rel).exists()
    }
}

/// `Core` cô lập cho test + repo tạm đã mở.
pub async fn core_with(repo: &TestRepo) -> (Arc<Core>, tempfile::TempDir) {
    let data = tempfile::tempdir().unwrap();
    let core = Core::for_tests(data.path(), repo.env()).await;
    (core, data)
}

pub async fn open(core: &Arc<Core>, repo: &TestRepo) -> OpenedRepo {
    let picked = core.registry.grant_folder(repo.root());
    core.open_repo(OpenSource::Picked { token: picked.token }).await.expect("mở được repo thử nghiệm")
}

pub fn request(repo_id: &str, op_id: &str, kind: ExecKind, sub: &str, args: &[&str]) -> GitExecRequest {
    GitExecRequest {
        repo_id: repo_id.into(),
        op_id: op_id.into(),
        kind,
        sub: sub.into(),
        args: args.iter().map(|a| a.to_string()).collect(),
        stdin: None,
        env: None,
        profile: None,
    }
}

/// Chạy `exec_git` với bộ gom frame; trả kết quả lệnh và các frame đã nhận.
pub async fn run(core: &Arc<Core>, window: &str, request: GitExecRequest) -> (crate::errors::Result<()>, Arc<CollectSink>) {
    let sink = Arc::new(CollectSink::default());
    let result = core.exec_git(window, request, sink.clone(), Arc::new(AtomicBool::new(false))).await;
    (result, sink)
}

#[cfg(unix)]
pub fn make_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

#[cfg(not(unix))]
pub fn make_executable(_path: &Path) {}
