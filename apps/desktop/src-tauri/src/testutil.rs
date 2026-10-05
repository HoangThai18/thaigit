// A few helpers used only by tests running on Unix.
#![allow(dead_code)]

//! Shared test tooling: a real git repo in a temp directory, isolated from the machine's config and askpass. It never
//! touches the user's real repos.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use crate::accounts::Accounts;
use crate::core::{Core, GitExecRequest};
use crate::credential::CredentialServer;
use crate::exec::CollectSink;
use crate::policy::ExecKind;
use crate::pathutil::canonical;
use crate::policy::EnvMap;
use crate::registry::{OpenSource, OpenedRepo};

/// The test machine's git (PATH first, then the usual locations).
pub fn system_git() -> PathBuf {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    dirs.extend(["/usr/bin", "/opt/homebrew/bin", "/usr/local/bin"].iter().map(PathBuf::from));
    crate::locate::find_in_dirs(&dirs).expect("máy chạy test phải có git")
}

/// Clean base env: no `GIT_ASKPASS`/`SSH_ASKPASS`/VS Code variables, global/system git config disabled, own HOME.
pub fn clean_env(home: &Path) -> EnvMap {
    let mut env = EnvMap::default();
    let path = std::env::var_os("PATH").unwrap_or_else(|| OsString::from("/usr/bin:/bin"));
    env.set("PATH", path);
    env.set("HOME", home.as_os_str());
    env.set("USERPROFILE", home.as_os_str());
    env.set("XDG_CONFIG_HOME", home.join(".config").into_os_string());
    // A real file in the temp HOME (not /dev/null) so `git config --global` can write without touching the machine.
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
    /// The first PATH entry, where tests put fake programs (e.g. `git-remote-<vcs>`).
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

    /// Exactly the path `tempdir` returns (on macOS that goes through the `/var` → `/private/var` symlink).
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

    /// Run git (panics on failure), returning stdout.
    pub fn git(&self, args: &[&str]) -> String {
        let output = self.command(args).output().expect("chạy được git");
        assert!(output.status.success(), "git {args:?} thất bại: {}", String::from_utf8_lossy(&output.stderr));
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    /// Run git, returning (exit code, stdout, stderr) even on failure.
    pub fn git_raw(&self, args: &[&str]) -> (i32, String, String) {
        let output = self.command(args).output().expect("chạy được git");
        (
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stdout).into_owned(),
            String::from_utf8_lossy(&output.stderr).into_owned(),
        )
    }

    /// Run git with stdin, returning (exit code, stdout, stderr).
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

/// An isolated `Core` for tests + an already-open temp repo.
pub async fn core_with(repo: &TestRepo) -> (Arc<Core>, tempfile::TempDir) {
    let data = tempfile::tempdir().unwrap();
    let core = Core::for_tests(data.path(), repo.env()).await;
    (core, data)
}

/// Like `core_with` but with a credential server pre-loaded with the accounts to use (test token → git).
pub async fn core_with_credential(repo: &TestRepo, accounts: Arc<Accounts>) -> (Arc<Core>, tempfile::TempDir) {
    let data = tempfile::tempdir().unwrap();
    let core = Core::for_tests_with_accounts(data.path(), repo.env(), accounts).await;
    let program = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("/bin/false"));
    let server = CredentialServer::start(program.into_os_string(), core.accounts.clone()).unwrap();
    let _ = core.credential.set(server);
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

/// Runs `exec_git` with a frame collector; returns the command result and the frames received.
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
