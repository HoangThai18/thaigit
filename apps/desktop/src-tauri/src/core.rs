//! Lõi không phụ thuộc Tauri: gom các hệ con (sổ repo, khoá, bảng op, watcher, định vị git) và thực thi `git_exec`.
//! Lớp lệnh IPC (`commands.rs`) chỉ gọi vào đây nên toàn bộ logic kiểm thử được bằng `cargo test` không cần cửa sổ.

use std::collections::{BTreeMap, HashMap};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::Deserialize;

use crate::accounts::Accounts;
use crate::credential::CredentialServer;
use crate::errors::{AppError, Result};
use crate::exec::{CancelTiming, CancelToken, Collected, CollectSink, ExitInfo, FrameSink, LimitedSink, ProcessSpec, run_process};
use crate::frames::exit_frame;
use crate::locate::{GitInfo, Locator};
use crate::locks::{Holder, Locks};
use crate::pathutil::{canonical, relative_to};
use crate::policy::{EnvMap, EnvOptions, EnvProfile, ExecKind, is_no_index_diff, policy};
use crate::registry::{ConfigFingerprint, OpenSource, OpenedRepo, RepoEntry, Registry};
use crate::trust::{self, Restrictions};
use crate::watcher::{RepoChangedEvent, Watchers};

/// Sự kiện đẩy sang webview (Tauri `emit_to`) — tách ra để test không cần cửa sổ.
pub trait EventSink: Send + Sync + 'static {
    fn repo_changed(&self, window: &str, event: &RepoChangedEvent);
    fn git_env_changed(&self);
}

/// Bỏ qua mọi sự kiện (test).
pub struct NullEvents;

impl EventSink for NullEvents {
    fn repo_changed(&self, _window: &str, _event: &RepoChangedEvent) {}
    fn git_env_changed(&self) {}
}

/// Tham số `git_exec` (JSON từ webview, khớp `GitExecRequest` trong `packages/contracts/src/ipc.ts`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitExecRequest {
    pub repo_id: String,
    pub op_id: String,
    pub kind: ExecKind,
    pub sub: String,
    pub args: Vec<String>,
    pub stdin: Option<String>,
    pub env: Option<BTreeMap<String, String>>,
    pub profile: Option<EnvProfile>,
}

/// Kích thước tối đa của stdin sau khi giải base64 (patch, danh sách path — luôn nhỏ).
pub const MAX_STDIN_BYTES: usize = 64 * 1024 * 1024;

/// Tổng output (stdout + stderr) tối đa của MỘT lệnh `git_exec`/`git_clone`. Webview không báo nhận frame nên không có backpressure
/// thật; đây là chặn trên cho hàng đợi IPC của Tauri khi webview treo hoặc bị chiếm quyền. Rộng hơn mọi dùng thật (log nghìn commit
/// vài MB, blob vài chục MB) nhưng đủ nhỏ để một lệnh không làm app hết bộ nhớ. Vượt → dừng lệnh và trả lỗi `io` rõ ràng.
pub const MAX_EXEC_OUTPUT_BYTES: u64 = 256 * 1024 * 1024;

/// Output tối đa mà lệnh git NỘI BỘ (`run_git`: khám phá repo, quét cấu hình, kiểm track…) được gom vào bộ nhớ.
pub const MAX_INTERNAL_OUTPUT_BYTES: u64 = 64 * 1024 * 1024;

/// Op đang chạy hoặc đang xếp hàng.
pub struct OpEntry {
    pub id: String,
    pub window: String,
    pub kind: ExecKind,
    pub repo_id: Option<String>,
    pub common_key: Option<String>,
    pub cancel: Arc<CancelToken>,
    /// Webview đã tải lại/đóng: bỏ frame, không gửi nữa.
    pub detached: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct Ops {
    map: Mutex<HashMap<String, Arc<OpEntry>>>,
}

/// Gỡ op khỏi bảng khi xong (kể cả lỗi).
pub struct OpGuard {
    ops: Arc<Ops>,
    id: String,
}

impl Drop for OpGuard {
    fn drop(&mut self) {
        self.ops.map.lock().unwrap_or_else(|p| p.into_inner()).remove(&self.id);
    }
}

impl Ops {
    pub(crate) fn register(self: &Arc<Self>, entry: OpEntry) -> Result<(Arc<OpEntry>, OpGuard)> {
        let mut map = self.map.lock().unwrap_or_else(|p| p.into_inner());
        if map.contains_key(&entry.id) {
            return Err(AppError::Conflict(format!("opId `{}` đang được dùng", entry.id)));
        }
        let entry = Arc::new(entry);
        map.insert(entry.id.clone(), entry.clone());
        Ok((entry.clone(), OpGuard { ops: self.clone(), id: entry.id.clone() }))
    }

    pub fn get(&self, id: &str) -> Option<Arc<OpEntry>> {
        self.map.lock().unwrap_or_else(|p| p.into_inner()).get(id).cloned()
    }

    pub fn of_window(&self, window: &str) -> Vec<Arc<OpEntry>> {
        self.map.lock().unwrap_or_else(|p| p.into_inner()).values().filter(|o| o.window == window).cloned().collect()
    }

    /// Repo (theo `commonDir`) còn tiến trình git do app chạy không?
    pub fn has_repo_ops(&self, common_key: &str) -> bool {
        self.map.lock().unwrap_or_else(|p| p.into_inner()).values().any(|o| o.common_key.as_deref() == Some(common_key))
    }

    pub fn len(&self) -> usize {
        self.map.lock().unwrap_or_else(|p| p.into_inner()).len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

pub struct Core {
    pub data_dir: PathBuf,
    /// Thư mục rỗng dùng làm `core.hooksPath` ở chế độ hạn chế.
    pub empty_hooks_dir: PathBuf,
    pub locator: Arc<Locator>,
    pub registry: Registry,
    pub locks: Locks,
    pub ops: Arc<Ops>,
    pub watchers: Watchers,
    pub events: Arc<dyn EventSink>,
    /// Chương trình trả lời "từ chối" cho `GIT_ASKPASS`/`SSH_ASKPASS` của hồ sơ background.
    pub askpass_deny: Option<OsString>,
    /// Máy chủ askpass tương tác (hỏi mật khẩu trong app) — có sau `askpass::init`; chưa có thì lệnh interactive không hỏi được.
    pub askpass: std::sync::OnceLock<Arc<crate::askpass::AskpassServer>>,
    /// Tài khoản + token của các máy chủ git (token trong kho bí mật của hệ điều hành).
    pub accounts: Arc<Accounts>,
    /// Credential helper trả lời `git credential` — có sau `credential::init`; chưa có thì lệnh mạng không dùng token của app.
    pub credential: std::sync::OnceLock<Arc<CredentialServer>>,
    pub timing: CancelTiming,
    /// Giới hạn output của `git_exec`/`git_clone` (xem `MAX_EXEC_OUTPUT_BYTES`).
    pub exec_output_limit: u64,
    /// Giới hạn output gom trong bộ nhớ của `run_git` (xem `MAX_INTERNAL_OUTPUT_BYTES`).
    pub internal_output_limit: u64,
    /// Env gốc cố định (test); `None` = env của tiến trình.
    base_env: Option<EnvMap>,
}

/// Kết quả chạy một lệnh git nội bộ.
pub struct GitOutput {
    pub exit: ExitInfo,
    pub collected: Collected,
}

impl GitOutput {
    pub fn ok(&self) -> bool {
        self.exit.code == 0
    }

    pub fn stdout(&self) -> String {
        self.collected.stdout_text()
    }

    pub fn stderr(&self) -> String {
        self.collected.stderr_text()
    }
}

/// Tham số dựng tiến trình git.
pub struct SpawnOptions<'a> {
    pub cwd: &'a Path,
    pub sub: &'a str,
    pub args: &'a [String],
    pub stdin: Option<Vec<u8>>,
    pub profile: EnvProfile,
    pub caller_env: BTreeMap<String, String>,
    pub restrictions: Option<&'a Restrictions>,
}

pub(crate) fn validate_op_id(id: &str) -> Result<()> {
    let ok = !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if ok { Ok(()) } else { Err(AppError::policy("opId chỉ gồm chữ, số, `-`, `_` (tối đa 64 ký tự)")) }
}

/// `GIT_INDEX_FILE` do frontend gửi: đường dẫn tuyệt đối, tên file đơn, nằm trong git dir của repo.
fn check_index_file(value: &str, entry: &RepoEntry) -> Result<()> {
    let path = Path::new(value);
    let inside = path.is_absolute()
        && !path.components().any(|c| matches!(c, std::path::Component::ParentDir))
        && path.file_name().is_some()
        && path.parent().and_then(|parent| canonical(parent).ok()).is_some_and(|parent| {
            relative_to(&parent, &entry.git_dir).is_some() || relative_to(&parent, &entry.common_dir).is_some()
        });
    if inside { Ok(()) } else { Err(AppError::policy("GIT_INDEX_FILE phải là đường dẫn tuyệt đối nằm trong git dir của repo")) }
}

/// Tên dịch vụ trong kho bí mật của hệ điều hành (Keychain / Credential Manager) — mỗi mục là token của một tài khoản.
pub const KEYCHAIN_SERVICE: &str = "Thaigit";

impl Core {
    pub fn new(data_dir: PathBuf, events: Arc<dyn EventSink>, askpass_deny: Option<OsString>) -> Arc<Self> {
        let accounts = Accounts::load(&data_dir, Arc::new(crate::accounts::KeychainStore::new(KEYCHAIN_SERVICE)));
        Self::with_accounts(data_dir, events, askpass_deny, accounts)
    }

    /// Như `new` nhưng dùng kho tài khoản cho sẵn (test).
    pub fn with_accounts(
        data_dir: PathBuf,
        events: Arc<dyn EventSink>,
        askpass_deny: Option<OsString>,
        accounts: Arc<Accounts>,
    ) -> Arc<Self> {
        let empty_hooks_dir = data_dir.join("empty-hooks");
        let _ = std::fs::create_dir_all(&empty_hooks_dir);
        Arc::new(Self {
            locator: Arc::new(Locator::new(&data_dir)),
            registry: Registry::new(&data_dir),
            locks: Locks::default(),
            ops: Arc::new(Ops::default()),
            watchers: Watchers::new(events.clone()),
            events,
            askpass_deny,
            askpass: std::sync::OnceLock::new(),
            accounts,
            credential: std::sync::OnceLock::new(),
            timing: CancelTiming::default(),
            exec_output_limit: MAX_EXEC_OUTPUT_BYTES,
            internal_output_limit: MAX_INTERNAL_OUTPUT_BYTES,
            base_env: None,
            empty_hooks_dir,
            data_dir,
        })
    }

    /// Dựng cho test: git cố định, env gốc cố định (cô lập khỏi cấu hình git/askpass của máy), thời gian huỷ ngắn.
    #[cfg(test)]
    pub async fn for_tests(data_dir: &Path, base_env: EnvMap) -> Arc<Self> {
        Self::for_tests_with(data_dir, base_env, Some(OsString::from("/test/askpass-deny"))).await
    }

    #[cfg(test)]
    pub async fn for_tests_with(data_dir: &Path, base_env: EnvMap, askpass_deny: Option<OsString>) -> Arc<Self> {
        Self::for_tests_limited(data_dir, base_env, askpass_deny, (MAX_EXEC_OUTPUT_BYTES, MAX_INTERNAL_OUTPUT_BYTES)).await
    }

    /// Như `for_tests_with` nhưng đặt giới hạn output `(git_exec, lệnh nội bộ)`.
    #[cfg(test)]
    pub async fn for_tests_limited(data_dir: &Path, base_env: EnvMap, askpass_deny: Option<OsString>, limits: (u64, u64)) -> Arc<Self> {
        let accounts = Accounts::load(data_dir, Arc::new(crate::accounts::MemoryStore::default()));
        Self::for_tests_full(data_dir, base_env, askpass_deny, limits, accounts).await
    }

    /// Như `for_tests_limited` nhưng dùng kho tài khoản cho sẵn (test credential / tài khoản).
    #[cfg(test)]
    pub async fn for_tests_with_accounts(
        data_dir: &Path,
        base_env: EnvMap,
        accounts: Arc<Accounts>,
    ) -> Arc<Self> {
        Self::for_tests_full(data_dir, base_env, Some(OsString::from("/test/askpass-deny")), (MAX_EXEC_OUTPUT_BYTES, MAX_INTERNAL_OUTPUT_BYTES), accounts)
            .await
    }

    #[cfg(test)]
    async fn for_tests_full(
        data_dir: &Path,
        base_env: EnvMap,
        askpass_deny: Option<OsString>,
        limits: (u64, u64),
        accounts: Arc<Accounts>,
    ) -> Arc<Self> {
        let git = crate::testutil::system_git();
        let events: Arc<dyn EventSink> = Arc::new(NullEvents);
        let empty_hooks_dir = data_dir.join("empty-hooks");
        std::fs::create_dir_all(&empty_hooks_dir).unwrap();
        let core = Self {
            locator: Locator::with_fixed_git(data_dir, &git).await,
            registry: Registry::new(data_dir),
            locks: Locks::default(),
            ops: Arc::new(Ops::default()),
            watchers: Watchers::new(events.clone()),
            events,
            askpass_deny,
            askpass: std::sync::OnceLock::new(),
            accounts,
            credential: std::sync::OnceLock::new(),
            timing: CancelTiming {
                soft_wait: Duration::from_millis(600),
                group_grace: Duration::from_millis(200),
                reader_grace: Duration::from_millis(800),
            },
            exec_output_limit: limits.0,
            internal_output_limit: limits.1,
            base_env: Some(base_env),
            empty_hooks_dir,
            data_dir: data_dir.to_path_buf(),
        };
        Arc::new(core)
    }

    fn base_env(&self) -> EnvMap {
        let mut env = self.base_env.clone().unwrap_or_else(EnvMap::from_process);
        if self.base_env.is_none() {
            env.set("PATH", self.locator.path_env());
        }
        env
    }

    /// Dựng tiến trình git: argv (`-c` cứng + sub + args), env chuẩn của chính sách, ghi đè chế độ hạn chế.
    pub fn build_spec(&self, git: &GitInfo, options: SpawnOptions<'_>) -> ProcessSpec {
        self.build_spec_with(git, options, None, None)
    }

    /// Như `build_spec`, kèm phiên askpass tương tác của lệnh (chỉ có tác dụng với hồ sơ `interactive`) và phiên credential
    /// (đưa token của tài khoản cho lệnh mạng chạm remote HTTPS của host đã đăng nhập).
    pub fn build_spec_with(
        &self,
        git: &GitInfo,
        options: SpawnOptions<'_>,
        askpass: Option<&crate::askpass::AskpassSession>,
        credential: Option<&crate::credential::CredentialSession>,
    ) -> ProcessSpec {
        let policy = policy();
        let interactive = options.profile == EnvProfile::Interactive;
        let mut extra = options.restrictions.map(Restrictions::env).unwrap_or_default();
        if interactive && let Some(session) = askpass {
            extra.extend(session.env());
        }
        if let Some(session) = credential {
            extra.extend(session.env());
        }
        let mut argv = policy.build_argv(options.sub, options.args);
        if let Some(session) = credential {
            // `-c` của helper phải nằm TRƯỚC subcommand (chính sách chèn cờ ở đúng vị trí đó).
            let sub_position = argv.iter().position(|arg| arg == options.sub).unwrap_or(argv.len());
            let mut extra_args: Vec<String> = Vec::new();
            for host in session.hosts() {
                extra_args.extend(crate::credential::helper_config(host, std::path::Path::new(session.program())));
            }
            for (offset, arg) in extra_args.into_iter().enumerate() {
                argv.insert(sub_position + offset, arg);
            }
        }
        let env_options = EnvOptions {
            profile: options.profile,
            caller_env: options.caller_env,
            askpass: askpass.filter(|_| interactive).map(|session| session.program().clone()),
            askpass_deny: self.askpass_deny.clone(),
            extra,
        };
        let env = policy.build_env(self.base_env(), &env_options);
        ProcessSpec {
            program: PathBuf::from(&git.path),
            args: argv.into_iter().map(OsString::from).collect(),
            cwd: options.cwd.to_path_buf(),
            env: env.into_pairs(),
            stdin: options.stdin,
        }
    }

    /// Phiên credential cho một lệnh mạng chạm các URL `urls`: chỉ tạo khi URL đó có remote HTTPS của host đã đăng nhập.
    pub fn credential_session(&self, urls: &[String]) -> Option<crate::credential::CredentialSession> {
        let server = self.credential.get()?;
        let hosts = crate::credential::helper_hosts(urls, &self.accounts);
        (!hosts.is_empty()).then(|| server.session(hosts))
    }

    /// Đăng ký op vào bảng (huỷ được theo `opId`, gắn nhãn cửa sổ).
    pub(crate) fn register_op(&self, entry: OpEntry) -> Result<(Arc<OpEntry>, OpGuard)> {
        self.ops.register(entry)
    }

    pub(crate) fn require_git(&self, sub: &str) -> Result<Arc<GitInfo>> {
        let git = self.locator.current()?;
        if git.too_old {
            return Err(AppError::GitTooOld(git.warning.clone().unwrap_or_else(|| "Phiên bản git quá cũ".into())));
        }
        if git.blocks(sub) {
            return Err(AppError::GitTooOld(git.warning.clone().unwrap_or_else(|| "Phiên bản git dưới sàn bảo mật".into())));
        }
        Ok(git)
    }

    /// Chạy một lệnh git nội bộ (mã của chính app, không qua `validate`) và gom toàn bộ output.
    pub async fn run_git(&self, options: SpawnOptions<'_>, timeout: Option<Duration>) -> Result<GitOutput> {
        let git = self.require_git(options.sub)?;
        let spec = self.build_spec(&git, options);
        self.run_spec(spec, timeout).await
    }

    /// Chạy một tiến trình git đã dựng và gom toàn bộ output (giới hạn bộ nhớ + thời gian chờ).
    pub(crate) async fn run_spec(&self, spec: ProcessSpec, timeout: Option<Duration>) -> Result<GitOutput> {
        let sink = Arc::new(CollectSink::default());
        let cancel = CancelToken::new();
        let capped = Arc::new(LimitedSink::new(sink.clone(), self.internal_output_limit, cancel.clone()));
        let watchdog = timeout.map(|limit| {
            let cancel = cancel.clone();
            tokio::spawn(async move {
                tokio::time::sleep(limit).await;
                cancel.cancel();
            })
        });
        let result = run_process(spec, capped.clone(), Some(cancel), self.timing).await;
        if let Some(watchdog) = watchdog {
            watchdog.abort();
        }
        let exit = result?;
        if capped.exceeded() {
            return Err(AppError::Io(format!("Output của lệnh git nội bộ vượt giới hạn {} MiB nên đã bị dừng", capped.limit() / (1024 * 1024))));
        }
        let mut collected = sink.collect();
        collected.exit = Some(exit);
        if exit.cancelled {
            return Err(AppError::Io("Lệnh git quá thời gian chờ".into()));
        }
        Ok(GitOutput { exit, collected })
    }

    /// Lệnh git đọc ngắn trong một thư mục (khám phá repo, quét cấu hình…).
    pub async fn git_plain(&self, cwd: &Path, sub: &str, args: &[&str], restrictions: Option<&Restrictions>) -> Result<GitOutput> {
        let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        self.run_git(
            SpawnOptions {
                cwd,
                sub,
                args: &args,
                stdin: None,
                profile: EnvProfile::Background,
                caller_env: BTreeMap::new(),
                restrictions,
            },
            Some(Duration::from_secs(60)),
        )
        .await
    }

    // --- mở repo ---------------------------------------------------------------------------------------------------

    /// `open_repo`: chuẩn hoá đường dẫn, tìm gốc/gitDir/commonDir bằng `git rev-parse`, quét khoá chạy lệnh + hook.
    pub async fn open_repo(&self, source: OpenSource) -> Result<OpenedRepo> {
        let (picked, recent_id) = match source {
            OpenSource::Picked { token } => (self.registry.take_grant(&token)?, None),
            OpenSource::Recent { id } => {
                let path = self
                    .registry
                    .recent_path(&id)
                    .ok_or_else(|| AppError::NotFound("Repo không còn trong danh sách gần đây".into()))?;
                (path, Some(id))
            }
        };
        match self.open_path(&picked, false).await {
            Ok(entry) => {
                self.registry.touch_recent(&entry.root);
                self.registry.set_reported(&entry.id, &entry.findings_hash);
                Ok(entry.opened())
            }
            Err(error) => {
                // Thư mục đã bị xoá/di chuyển: bỏ khỏi danh sách gần đây.
                if let Some(id) = recent_id
                    && error.code() == "not-found"
                {
                    self.registry.forget_recent(&id);
                }
                Err(error)
            }
        }
    }

    /// Mở thư mục thành repo (đã đáng tin nếu `trusted`: repo do app tạo/clone).
    pub async fn open_path(&self, dir: &Path, trusted: bool) -> Result<Arc<RepoEntry>> {
        let canonical_dir = canonical(dir).map_err(|e| AppError::io("Mở thư mục", &e))?;
        if !canonical_dir.is_dir() {
            return Err(AppError::NotFound("Đường dẫn không phải thư mục".into()));
        }
        let output = self
            .git_plain(
                &canonical_dir,
                "rev-parse",
                &["--path-format=absolute", "--show-toplevel", "--absolute-git-dir", "--git-common-dir"],
                None,
            )
            .await?;
        if !output.ok() {
            let stderr = output.stderr();
            return Err(if stderr.contains("not a git repository") {
                AppError::NotFound("Thư mục này không phải repo git".into())
            } else if stderr.contains("must be run in a work tree") {
                AppError::NotFound("Đây là repo bare — Thaigit chỉ mở repo có working tree".into())
            } else {
                AppError::Io(format!("Không mở được repo: {}", stderr.trim()))
            });
        }
        let stdout = output.stdout();
        let mut lines = stdout.lines();
        let (Some(top), Some(git_dir), Some(common)) = (lines.next(), lines.next(), lines.next()) else {
            return Err(AppError::NotFound("Thư mục này không phải repo git".into()));
        };
        let resolve = |text: &str| canonical(Path::new(text)).map_err(|e| AppError::io("Chuẩn hoá đường dẫn repo", &e));
        let (root, git_dir, common_dir) = (resolve(top)?, resolve(git_dir)?, resolve(common)?);
        // Gốc working tree phải chứa thư mục đã chọn; nếu không (vd. `core.worktree` trỏ đi nơi khác) thì từ chối.
        if relative_to(&canonical_dir, &root).is_none() {
            return Err(AppError::OutOfScope("Working tree của repo nằm ngoài thư mục đã chọn".into()));
        }
        let entry = self.scan_repo(root, git_dir, common_dir, trusted).await?;
        Ok(self.registry.insert(entry))
    }

    async fn scan_repo(&self, root: PathBuf, git_dir: PathBuf, common_dir: PathBuf, force_trusted: bool) -> Result<RepoEntry> {
        // Chụp dấu các file cấu hình chắc chắn có TRƯỚC khi quét: một lần ghi xen vào giữa làm dấu sau khác dấu trước.
        let before = ConfigFingerprint::capture(ConfigFingerprint::base_paths(&git_dir, &common_dir));
        let output = self.git_plain(&root, "config", &["--list", "--show-scope", "--show-origin", "-z"], None).await?;
        if !output.ok() {
            return Err(AppError::Io(format!("Không đọc được cấu hình repo: {}", output.stderr().trim())));
        }
        let entries = trust::parse_config_list(&output.collected.stdout);
        let hooks = trust::read_hooks(&common_dir);
        // Theo dõi mọi file mà lần quét đã đọc (origin `file:`) + đích include + HEAD, không chỉ `.git/config`.
        let mut watched = ConfigFingerprint::base_paths(&git_dir, &common_dir);
        watched.extend(trust::config_files(&entries, &root));
        let mut fingerprint = ConfigFingerprint::capture(watched);
        if !fingerprint.consistent_with(&before) {
            fingerprint = fingerprint.into_volatile();
        }
        if force_trusted {
            // Repo do app tạo/clone: ghi nhận tin cậy theo tập khoá hiện có (kể cả hook từ `init.templateDir` của người dùng).
            let hash = trust::findings_hash(&entries, &hooks);
            self.registry.trust.trust(&crate::pathutil::path_key(&root), &hash)?;
        }
        Ok(self.registry.build_entry(root, git_dir, common_dir, entries, &hooks, &self.empty_hooks_dir, force_trusted, fingerprint))
    }

    /// `trust_repo`: ghi nhận tin tưởng (realpath + băm tập khoá chạy lệnh) — nhưng CHỈ cho tập khoá mà người dùng đã được xem
    /// (kết quả `open_repo`/`trust_repo` gần nhất). Cấu hình có thể đổi sau đó (chuyển nhánh kéo vào file `include` khác…): quét
    /// lại thấy tập khác thì không tin tưởng, trả repo vẫn `unknown` kèm danh sách MỚI để người dùng xem rồi bấm lại.
    pub async fn trust_repo(&self, repo_id: &str) -> Result<OpenedRepo> {
        let entry = self.registry.get(repo_id)?;
        if entry.trusted {
            return Ok(entry.opened());
        }
        let current = self.scan_repo(entry.root.clone(), entry.git_dir.clone(), entry.common_dir.clone(), false).await?;
        if self.registry.reported(repo_id).as_deref() != Some(current.findings_hash.as_str()) {
            let fresh = self.registry.insert(current);
            self.registry.set_reported(repo_id, &fresh.findings_hash);
            return Ok(fresh.opened());
        }
        self.registry.trust.trust(&crate::pathutil::path_key(&entry.root), &current.findings_hash)?;
        let trusted = self.scan_repo(entry.root.clone(), entry.git_dir.clone(), entry.common_dir.clone(), false).await?;
        let trusted = self.registry.insert(trusted);
        self.registry.set_reported(repo_id, &trusted.findings_hash);
        Ok(trusted.opened())
    }

    /// Repo chưa tin cậy mà một file cấu hình (kể cả file `include`) hoặc HEAD đã đổi → quét lại để ghi đè luôn đúng với cấu
    /// hình hiện tại. Phần còn thiếu của việc này (file ta không theo dõi được) do `Restrictions::fail_closed` bù.
    pub async fn fresh_entry(&self, entry: Arc<RepoEntry>) -> Result<Arc<RepoEntry>> {
        if entry.trusted || entry.fingerprint.unchanged() {
            return Ok(entry);
        }
        let rescanned = self.scan_repo(entry.root.clone(), entry.git_dir.clone(), entry.common_dir.clone(), false).await?;
        Ok(self.registry.insert(rescanned))
    }

    // --- git_exec --------------------------------------------------------------------------------------------------

    /// `git_exec`: kiểm chính sách → xếp hàng khoá theo repo → spawn → stream frame → frame `exit` cuối cùng.
    /// Lỗi trước khi spawn trả `Err` (invoke reject); từ lúc spawn mọi kết quả nằm trong frame `exit`.
    pub async fn exec_git(
        self: &Arc<Self>,
        window: &str,
        request: GitExecRequest,
        sink: Arc<dyn FrameSink>,
        detached: Arc<AtomicBool>,
    ) -> Result<()> {
        validate_op_id(&request.op_id)?;
        let policy = policy();
        let caller_env = request.env.clone().unwrap_or_default();
        if let Some(violation) = policy.validate(&request.sub, &request.args, &caller_env) {
            return Err(AppError::policy(violation.to_string()));
        }
        if let Some(violation) = policy.check_scope(&request.sub, &request.args) {
            return Err(AppError::policy(violation.to_string()));
        }
        let kind = policy.resolve_kind(&request.sub, &request.args, request.kind).map_err(AppError::policy)?;
        let entry = self.registry.get(&request.repo_id)?;
        if let Some(index_file) = caller_env.get("GIT_INDEX_FILE") {
            check_index_file(index_file, &entry)?;
        }
        let git = self.require_git(&request.sub)?;
        let entry = self.fresh_entry(entry).await?;
        let profile = request.profile.unwrap_or_default();
        // Repo chưa tin cậy mà cấu hình hiệu lực có thể đổi sau lần quét (`include` tới file đã track, `includeIf onbranch:`): ghi đè
        // dựng từ lần quét có thể đã cũ nên chỉ cho chạy lệnh đọc thuần tuý, không thể chạy lệnh do cấu hình chỉ định.
        if let Some(restrictions) = &entry.restrictions
            && restrictions.fail_closed
            && !policy.is_exec_free(&request.sub, &request.args)
        {
            return Err(AppError::Untrusted(format!(
                "Repo chưa được tin cậy và có cấu hình không thể vô hiệu hoá trước (vd. `include` trỏ tới file đổi theo nhánh) nên lệnh `{}` bị chặn. Hãy tin tưởng repo để tiếp tục.",
                request.sub
            )));
        }
        // git-lfs tự cài hook vào thư mục hook hiệu lực — với repo chưa tin cậy đó là thư mục hook rỗng DÙNG CHUNG của app. Chỉ
        // `lfs version` (không cài gì) được chạy trước khi tin tưởng.
        if entry.restrictions.is_some() && request.sub == "lfs" && request.args.first().map(String::as_str) != Some("version") {
            return Err(AppError::Untrusted("Repo chưa được tin cậy nên chưa dùng được Git LFS. Hãy tin tưởng repo để tiếp tục.".into()));
        }
        // `remote prune|set-head|show` (và `submodule update`) cũng liên lạc với máy chủ nên bị coi như lệnh mạng khi có khoá
        // không vô hiệu hoá được (`submodule update` clone / fetch theo `.gitmodules` của repo).
        let contacts_remote = kind == ExecKind::Network
            || (request.sub == "remote" && matches!(request.args.first().map(String::as_str), Some("prune" | "set-head" | "show")))
            || (request.sub == "submodule" && request.args.first().map(String::as_str) == Some("update"));
        if let Some(restrictions) = &entry.restrictions
            && contacts_remote
            && (restrictions.blocks_network || (kind == ExecKind::Network && profile == EnvProfile::Background))
        {
            return Err(AppError::Untrusted(
                "Repo chưa được tin cậy nên không tự fetch / không chạy lệnh mạng. Hãy tin tưởng repo để tiếp tục.".into(),
            ));
        }
        let stdin = match &request.stdin {
            None => None,
            Some(encoded) => {
                if encoded.len() > MAX_STDIN_BYTES / 3 * 4 + 8 {
                    return Err(AppError::policy("stdin quá lớn"));
                }
                let bytes = BASE64.decode(encoded).map_err(|e| AppError::policy(format!("stdin không phải base64: {e}")))?;
                if bytes.len() > MAX_STDIN_BYTES {
                    return Err(AppError::policy("stdin quá lớn"));
                }
                Some(bytes)
            }
        };
        // Lệnh mạng do người dùng bấm: git/ssh hỏi tên đăng nhập / mật khẩu / passphrase thì hiện hộp thoại trong cửa sổ này.
        let askpass = (profile == EnvProfile::Interactive && kind == ExecKind::Network)
            .then(|| self.askpass.get().map(|server| server.session(window, &request.op_id, &format!("git {}", request.sub))))
            .flatten();
        // Lệnh mạng chạm remote HTTPS của host đã đăng nhập: git hỏi credential thì app trả token của tài khoản đúng owner.
        // Cả hồ sơ background (tự fetch) cũng dùng được — không bao giờ mở hộp thoại, chỉ trả token đã lưu.
        let credential = if kind == ExecKind::Network {
            let urls = self.remote_urls(&entry.id).await.unwrap_or_default();
            self.credential_session(&urls)
        } else {
            None
        };
        let spec = self.build_spec_with(
            &git,
            SpawnOptions {
                cwd: &entry.root,
                sub: &request.sub,
                args: &request.args,
                stdin,
                profile,
                caller_env,
                restrictions: entry.restrictions.as_ref(),
            },
            askpass.as_ref(),
            credential.as_ref(),
        );

        let cancel = CancelToken::new();
        let (_op, _op_guard) = self.ops.register(OpEntry {
            id: request.op_id.clone(),
            window: window.to_string(),
            kind,
            repo_id: Some(entry.id.clone()),
            common_key: Some(entry.common_key.clone()),
            cancel: cancel.clone(),
            detached: detached.clone(),
        })?;
        // Giới hạn đứng TRƯỚC bộ tách rời: op đã bị tách (webview tải lại) không còn frame nào vào hàng đợi nên không tính.
        let limited = Arc::new(LimitedSink::new(sink, self.exec_output_limit, cancel.clone()));
        let sink: Arc<dyn FrameSink> = Arc::new(DetachableSink { inner: limited.clone(), detached });

        let lock = self.locks.for_key(&entry.common_key);
        // `diff --no-index` đọc thẳng qua hệ thống file nên kiểm toán hạng rồi mới chạy là cửa sổ TOCTOU: giữ khoá độc quyền để
        // không lệnh ghi nào của app (apply/checkout/…) kịp đặt symlink vào giữa lúc kiểm và lúc git đọc.
        let guard = if kind == ExecKind::Read && !is_no_index_diff(&request.sub, &request.args) {
            None
        } else {
            let holder = Holder { op_id: request.op_id.clone(), background: profile == EnvProfile::Background && kind == ExecKind::Network, cancel: cancel.clone() };
            // Lệnh ghi nền (snapshot: index tạm + ref per-worktree) chỉ chạy khi rảnh, không bị chen và không tắt tiếng watcher.
            let quiet = profile == EnvProfile::Background && kind == ExecKind::Write;
            let acquired = if holder.background {
                lock.try_acquire_background(holder).map_err(AppError::from)
            } else if quiet {
                lock.try_acquire_quiet(holder).map_err(AppError::from)
            } else {
                lock.acquire(holder, Some(&cancel)).await.map_err(AppError::from)
            };
            match acquired {
                Ok(guard) => Some(guard),
                Err(AppError::Busy(_)) if cancel.is_cancelled() => {
                    // Huỷ khi còn xếp hàng: chưa chạy gì.
                    sink.send(exit_frame(-1, true));
                    return Ok(());
                }
                Err(error) => return Err(error),
            }
        };

        if request.sub == "diff" {
            crate::repo_fs::check_diff_operands(&entry, &request.args)?;
        }

        let started = Instant::now();
        let exit = run_process(spec, sink.clone(), Some(cancel), self.timing).await?;
        drop(guard);
        if limited.exceeded() {
            return Err(AppError::Io(format!(
                "Output của lệnh `git {}` vượt giới hạn {} MiB nên đã bị dừng",
                request.sub,
                limited.limit() / (1024 * 1024)
            )));
        }
        if request.sub == "status" {
            lock.record_status_ms(u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX));
        }
        sink.send(exit_frame(exit.code, exit.cancelled));
        Ok(())
    }

    /// `git_cancel`: chỉ huỷ lệnh `network` của chính cửa sổ gọi.
    pub fn cancel_op(&self, window: &str, op_id: &str) -> Result<bool> {
        let Some(op) = self.ops.get(op_id).filter(|o| o.window == window) else {
            return Ok(false);
        };
        if op.kind != ExecKind::Network {
            return Err(AppError::policy("chỉ huỷ được lệnh mạng; lệnh ghi không có nút huỷ"));
        }
        op.cancel.cancel();
        Ok(true)
    }

    /// `session_reset`: webview tải lại/đóng — huỷ op đọc/mạng, tách op ghi (để git tự xong, không giết giữa chừng) và bỏ watcher.
    pub fn reset_window(&self, window: &str) {
        for op in self.ops.of_window(window) {
            op.detached.store(true, Ordering::SeqCst);
            if op.kind != ExecKind::Write {
                op.cancel.cancel();
            }
        }
        self.watchers.remove_window(window);
    }
}

/// Bỏ frame khi webview đã tải lại (tránh `eval` vào trang mới).
struct DetachableSink {
    inner: Arc<dyn FrameSink>,
    detached: Arc<AtomicBool>,
}

impl FrameSink for DetachableSink {
    fn send(&self, frame: Vec<u8>) {
        if !self.detached.load(Ordering::SeqCst) {
            self.inner.send(frame);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frames::decode_exit_frame;
    #[cfg(unix)]
    use crate::testutil::make_executable;
    use crate::testutil::{TestRepo, core_with, open, request, run};
    use sha2::{Digest, Sha256};

    #[tokio::test]
    async fn git_status_streams_frames_and_ends_with_exactly_one_exit_frame() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1");
        repo.commit_all("init");
        repo.write("moi.txt", "2");
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        let mut req = request(&opened.repo_id, "op-status", ExecKind::Read, "status", &["--porcelain=v2", "--branch", "--untracked-files=all"]);
        req.env = Some([("GIT_OPTIONAL_LOCKS".to_string(), "0".to_string())].into());
        let (result, sink) = run(&core, "main", req).await;
        result.unwrap();
        let frames = sink.frames();
        let last = frames.last().expect("có frame");
        assert_eq!(decode_exit_frame(last), Some((0, false)), "frame cuối là exit");
        assert_eq!(frames.iter().filter(|f| f[0] == crate::frames::TAG_EXIT).count(), 1);
        assert!(frames[..frames.len() - 1].iter().all(|f| f[0] == crate::frames::TAG_STDOUT || f[0] == crate::frames::TAG_STDERR_LINE));
        let out = sink.collect();
        assert!(out.stdout_text().contains("? moi.txt"), "{}", out.stdout_text());
        assert!(out.stdout_text().contains("# branch.head main"));
        assert!(core.ops.is_empty(), "op được gỡ khỏi bảng sau khi xong");
        assert!(core.locks.for_key(&opened_common_key(&core, &opened)).status_ms() < 5_000);
    }

    fn opened_common_key(core: &Core, opened: &OpenedRepo) -> String {
        core.registry.get(&opened.repo_id).unwrap().common_key.clone()
    }

    #[tokio::test]
    async fn stdin_base64_reaches_git_and_non_zero_exit_is_reported_in_the_frame() {
        let repo = TestRepo::new();
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        let mut req = request(&opened.repo_id, "op-hash", ExecKind::Write, "hash-object", &["--stdin"]);
        req.stdin = Some(BASE64.encode(b"hello\n"));
        let (result, sink) = run(&core, "main", req).await;
        result.unwrap();
        assert_eq!(sink.collect().stdout_text().trim(), "ce013625030ba8dba906f756967f9e9ca394464a");
        // lỗi git (ref không tồn tại) → exit != 0 nằm trong frame, lệnh vẫn Ok
        let (result, sink) = run(&core, "main", request(&opened.repo_id, "op-bad", ExecKind::Read, "rev-parse", &["--verify", "refs/heads/khong-co"])).await;
        result.unwrap();
        let out = sink.collect();
        assert_ne!(out.exit.unwrap().code, 0);
        assert!(!out.stderr_text().is_empty() || out.stdout.is_empty());
        // stdin sai base64 / quá lớn bị từ chối trước khi spawn
        let mut bad = request(&opened.repo_id, "op-b64", ExecKind::Write, "hash-object", &["--stdin"]);
        bad.stdin = Some("***không-phải-base64***".into());
        assert_eq!(run(&core, "main", bad).await.0.unwrap_err().code(), "policy");
    }

    #[tokio::test]
    async fn policy_violations_are_rejected_before_anything_is_spawned() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1");
        repo.commit_all("init");
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        let marker = repo.tmp().join("pwned");
        let touch = format!("touch {}", marker.display());
        let id = opened.repo_id.as_str();
        type Attack<'a> = (ExecKind, &'a str, Vec<String>, Option<(&'a str, &'a str)>);
        let attacks: Vec<Attack<'_>> = vec![
            (ExecKind::Read, "status", vec!["-c".into(), format!("core.fsmonitor={touch}")], None),
            (ExecKind::Read, "status", vec![format!("-ccore.fsmonitor={touch}")], None),
            (ExecKind::Network, "fetch", vec![format!("--upload-pack={touch}"), "origin".into()], None),
            (ExecKind::Network, "fetch", vec![format!("--upl={touch}"), "origin".into()], None),
            (ExecKind::Network, "pull", vec![format!("ext::sh -c touch% {}", marker.display()), "main".into()], None),
            (ExecKind::Read, "status", vec![], Some(("GIT_SSH_COMMAND", "sh -c id"))),
            (ExecKind::Read, "status", vec![], Some(("GIT_EXTERNAL_DIFF", "sh"))),
            (ExecKind::Read, "status", vec![], Some(("GIT_CONFIG_COUNT", "1"))),
            (ExecKind::Write, "rebase", vec!["-x".into(), touch.clone(), "main".into()], None),
            (ExecKind::Read, "difftool", vec![], None),
            (ExecKind::Read, "submodule", vec!["update".into()], None),
            (ExecKind::Read, "diff", vec!["--no-index".into(), "--".into(), "/dev/null".into(), "/etc/passwd".into()], None),
            (ExecKind::Write, "commit", vec!["-F".into(), "/etc/passwd".into()], None),
            (ExecKind::Write, "config", vec!["core.fsmonitor".into(), touch.clone()], None),
            (ExecKind::Write, "remote", vec!["add".into(), "evil".into(), format!("ext::sh -c {touch}")], None),
        ];
        for (index, (kind, sub, args, env)) in attacks.into_iter().enumerate() {
            let mut req = GitExecRequest { repo_id: id.into(), op_id: format!("atk-{index}"), kind, sub: sub.into(), args, stdin: None, env: None, profile: None };
            if let Some((key, value)) = env {
                req.env = Some([(key.to_string(), value.to_string())].into());
            }
            let (result, sink) = run(&core, "main", req).await;
            let error = result.expect_err(&format!("{sub} phải bị chặn"));
            assert_eq!(error.code(), "policy", "{sub}: {error}");
            assert!(sink.frames().is_empty(), "không có frame nào khi bị chặn");
        }
        assert!(!marker.exists(), "không lệnh nào được chạy");
        assert!(core.ops.is_empty());
    }

    #[tokio::test]
    async fn kind_op_ids_and_unknown_repos_are_validated() {
        let repo = TestRepo::new();
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        let id = opened.repo_id.as_str();
        // kind yếu hơn chính sách → từ chối; network chỉ cho subcommand network
        assert_eq!(run(&core, "main", request(id, "k1", ExecKind::Read, "commit", &["--allow-empty", "-m", "x"])).await.0.unwrap_err().code(), "policy");
        assert_eq!(run(&core, "main", request(id, "k2", ExecKind::Network, "status", &[])).await.0.unwrap_err().code(), "policy");
        assert_eq!(run(&core, "main", request(id, "k3", ExecKind::Write, "fetch", &["--all"])).await.0.unwrap_err().code(), "policy");
        // opId xấu
        for bad in ["", "a b", "../x", &"x".repeat(65), "a;b"] {
            assert_eq!(run(&core, "main", request(id, bad, ExecKind::Read, "status", &[])).await.0.unwrap_err().code(), "policy", "{bad:?}");
        }
        // repo lạ
        assert_eq!(run(&core, "main", request("khong-co", "k4", ExecKind::Read, "status", &[])).await.0.unwrap_err().code(), "not-found");
        // GIT_INDEX_FILE chỉ trong git dir
        let mut req = request(id, "k5", ExecKind::Read, "status", &[]);
        req.env = Some([("GIT_INDEX_FILE".to_string(), "/tmp/evil-index".to_string())].into());
        assert_eq!(run(&core, "main", req).await.0.unwrap_err().code(), "policy");
        let mut req = request(id, "k6", ExecKind::Read, "status", &[]);
        req.env = Some([("GIT_INDEX_FILE".to_string(), repo.canonical_root().join(".git/index.tmp").to_string_lossy().into_owned())].into());
        let (result, sink) = run(&core, "main", req).await;
        result.unwrap();
        assert!(sink.collect().exit.is_some());
        let mut req = request(id, "k7", ExecKind::Read, "status", &[]);
        req.env = Some([("GIT_INDEX_FILE".to_string(), repo.canonical_root().join(".git/../escape").to_string_lossy().into_owned())].into());
        assert_eq!(run(&core, "main", req).await.0.unwrap_err().code(), "policy");
    }

    // Dùng script `#!/bin/sh` làm hook: chỉ chạy trên Unix (Windows kiểm ở CI Windows ở Phase 9).
    #[cfg(unix)]
    #[tokio::test]
    async fn duplicate_op_ids_conflict_while_the_first_is_running() {
        let repo = TestRepo::new();
        repo.write("a", "1");
        repo.commit_all("init");
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        // op 1 giữ khoá ghi: commit có hook chậm (repo phải được tin cậy để hook chạy).
        core.trust_repo(&opened.repo_id).await.unwrap();
        let slow = repo.tmp().join("slow-hook.sh");
        std::fs::write(&slow, "#!/bin/sh\nsleep 1\n").unwrap();
        std::fs::copy(&slow, repo.root().join(".git/hooks/pre-commit")).unwrap();
        make_executable(&repo.root().join(".git/hooks/pre-commit"));
        let core2 = core.clone();
        let id = opened.repo_id.clone();
        let first = tokio::spawn(async move { run(&core2, "main", request(&id, "dup", ExecKind::Write, "commit", &["--allow-empty", "-m", "một"])).await });
        tokio::time::sleep(Duration::from_millis(300)).await;
        let (second, _) = run(&core, "main", request(&opened.repo_id, "dup", ExecKind::Read, "status", &[])).await;
        assert_eq!(second.unwrap_err().code(), "conflict");
        let (result, sink) = first.await.unwrap();
        result.unwrap();
        assert_eq!(sink.collect().exit.unwrap().code, 0);
    }

    // Dùng script `#!/bin/sh` làm hook: chỉ chạy trên Unix (Windows kiểm ở CI Windows ở Phase 9).
    #[cfg(unix)]
    #[tokio::test]
    async fn write_ops_are_exclusive_but_reads_never_wait() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1");
        repo.commit_all("init");
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        core.trust_repo(&opened.repo_id).await.unwrap();
        let hook = repo.root().join(".git/hooks/pre-commit");
        let log = repo.tmp().join("order.log");
        std::fs::write(&hook, format!("#!/bin/sh\necho start >> '{0}'\nsleep 1\necho end >> '{0}'\n", log.display())).unwrap();
        make_executable(&hook);

        let spawn_commit = |name: &'static str| {
            let (core, id) = (core.clone(), opened.repo_id.clone());
            tokio::spawn(async move { run(&core, "main", request(&id, name, ExecKind::Write, "commit", &["--allow-empty", "-m", name])).await })
        };
        let first = spawn_commit("w1");
        tokio::time::sleep(Duration::from_millis(250)).await;
        let second = spawn_commit("w2");
        tokio::time::sleep(Duration::from_millis(250)).await;

        // đọc trong lúc hai lệnh ghi đang chạy/chờ: không bị chặn
        let started = Instant::now();
        let (status, sink) = run(&core, "main", request(&opened.repo_id, "r1", ExecKind::Read, "status", &["--porcelain=v2"])).await;
        status.unwrap();
        assert!(started.elapsed() < Duration::from_millis(700), "lệnh đọc không chờ khoá: {:?}", started.elapsed());
        assert_eq!(sink.collect().exit.unwrap().code, 0);

        for task in [first, second] {
            let (result, sink) = task.await.unwrap();
            result.unwrap();
            assert_eq!(sink.collect().exit.unwrap().code, 0);
        }
        // hook chạy tuần tự: start/end xen kẽ, không chồng nhau
        let order: Vec<String> = std::fs::read_to_string(&log).unwrap().lines().map(String::from).collect();
        assert_eq!(order, ["start", "end", "start", "end"]);
    }

    // Dùng script `#!/bin/sh` làm hook: chỉ chạy trên Unix (Windows kiểm ở CI Windows ở Phase 9).
    #[cfg(unix)]
    #[tokio::test]
    async fn queued_network_op_can_be_cancelled_before_it_ever_starts() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1");
        repo.commit_all("init");
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        core.trust_repo(&opened.repo_id).await.unwrap();
        let hook = repo.root().join(".git/hooks/pre-commit");
        std::fs::write(&hook, "#!/bin/sh\nsleep 1\n").unwrap();
        make_executable(&hook);
        let writer = {
            let (core, id) = (core.clone(), opened.repo_id.clone());
            tokio::spawn(async move { run(&core, "main", request(&id, "writer", ExecKind::Write, "commit", &["--allow-empty", "-m", "w"])).await })
        };
        tokio::time::sleep(Duration::from_millis(250)).await;
        let queued = {
            let (core, id) = (core.clone(), opened.repo_id.clone());
            tokio::spawn(async move { run(&core, "main", request(&id, "net", ExecKind::Network, "fetch", &["--all"])).await })
        };
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert!(core.cancel_op("main", "net").unwrap());
        let started = Instant::now();
        let (result, sink) = queued.await.unwrap();
        result.unwrap();
        let exit = sink.collect().exit.unwrap();
        assert!(exit.cancelled);
        assert!(started.elapsed() < Duration::from_millis(600), "huỷ khi còn xếp hàng phải xong ngay");
        let (result, _) = writer.await.unwrap();
        result.unwrap();
    }

    // Dùng script `#!/bin/sh` làm hook: chỉ chạy trên Unix (Windows kiểm ở CI Windows ở Phase 9).
    #[cfg(unix)]
    #[tokio::test]
    async fn only_network_ops_of_the_calling_window_can_be_cancelled() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1");
        repo.commit_all("init");
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        core.trust_repo(&opened.repo_id).await.unwrap();
        let hook = repo.root().join(".git/hooks/pre-commit");
        std::fs::write(&hook, "#!/bin/sh\nsleep 1\n").unwrap();
        make_executable(&hook);
        let writer = {
            let (core, id) = (core.clone(), opened.repo_id.clone());
            tokio::spawn(async move { run(&core, "win-a", request(&id, "writing", ExecKind::Write, "commit", &["--allow-empty", "-m", "w"])).await })
        };
        tokio::time::sleep(Duration::from_millis(300)).await;
        // lệnh ghi không có nút huỷ, không timeout
        assert_eq!(core.cancel_op("win-a", "writing").unwrap_err().code(), "policy");
        // op của cửa sổ khác / op không tồn tại → false
        assert!(!core.cancel_op("win-b", "writing").unwrap());
        assert!(!core.cancel_op("win-a", "khong-co").unwrap());
        let (result, sink) = writer.await.unwrap();
        result.unwrap();
        let exit = sink.collect().exit.unwrap();
        assert_eq!((exit.code, exit.cancelled), (0, false), "lệnh ghi chạy tới cùng");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancelling_a_running_fetch_stops_the_whole_process_tree_quickly() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1");
        repo.commit_all("init");
        let (core, _data) = core_with(&repo).await;
        let bare = repo.tmp().join("remote.git");
        repo.git(&["clone", "-q", "--bare", &repo.root().to_string_lossy(), &bare.to_string_lossy()]);
        // upload-pack giả: ghi pid rồi ngủ lâu (chạy như tiến trình con của git fetch)
        let pid_file = repo.tmp().join("uploadpack.pid");
        let script = repo.tmp().join("slow-upload-pack.sh");
        std::fs::write(&script, format!("#!/bin/sh\necho $$ > '{}'\nsleep 60\n", pid_file.display())).unwrap();
        make_executable(&script);
        repo.git(&["remote", "add", "origin", &bare.to_string_lossy()]);
        repo.git(&["config", "remote.origin.uploadpack", &script.to_string_lossy()]);
        let opened = open(&core, &repo).await;
        assert_eq!(opened.trust, "unknown", "remote.origin.uploadpack là khoá chạy lệnh");
        core.trust_repo(&opened.repo_id).await.unwrap();

        let task = {
            let (core, id) = (core.clone(), opened.repo_id.clone());
            tokio::spawn(async move { run(&core, "main", request(&id, "fetch-1", ExecKind::Network, "fetch", &["--all", "--progress"])).await })
        };
        for _ in 0..100 {
            if std::fs::read_to_string(&pid_file).is_ok_and(|s| !s.trim().is_empty()) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(pid_file.exists(), "fetch phải đã chạy upload-pack giả");
        let started = Instant::now();
        assert!(core.cancel_op("main", "fetch-1").unwrap());
        let (result, sink) = tokio::time::timeout(Duration::from_secs(8), task).await.expect("huỷ phải dừng trong ≤ 5 s").unwrap();
        result.unwrap();
        let exit = sink.collect().exit.unwrap();
        assert!(exit.cancelled, "kết quả {{cancelled: true, code}} chứ không bị che thành lỗi git");
        assert!(started.elapsed() < Duration::from_secs(5), "{:?}", started.elapsed());
        let pid: i32 = std::fs::read_to_string(&pid_file).unwrap().trim().parse().unwrap();
        let mut gone = false;
        for _ in 0..40 {
            if nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), None).is_err() {
                gone = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(gone, "không tiến trình mồ côi: upload-pack {pid} phải chết cùng git");
        assert!(core.ops.is_empty());
        // khoá của repo đã được thả: lệnh ghi kế tiếp chạy được ngay
        let (result, sink) = run(&core, "main", request(&opened.repo_id, "after", ExecKind::Write, "config", &["--get", "user.name"])).await;
        result.unwrap();
        assert!(sink.collect().exit.is_some());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn killing_git_mid_write_leaves_an_orphan_lock_that_health_reports_and_removes() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1");
        repo.commit_all("init");
        // `git add` giữ `.git/index.lock` suốt lúc chạy bộ lọc clean → chỗ chắc chắn để giết git khi đang giữ khoá.
        let pgid_file = repo.tmp().join("filter.pgid");
        let pass_flag = repo.tmp().join("let-it-pass");
        let filter = repo.tmp().join("slow-clean.sh");
        std::fs::write(
            &filter,
            format!("#!/bin/sh\nif [ ! -e '{flag}' ]; then ps -o pgid= -p $$ | tr -d ' ' > '{pgid}'; sleep 30; fi\ncat\n", flag = pass_flag.display(), pgid = pgid_file.display()),
        )
        .unwrap();
        make_executable(&filter);
        repo.write(".gitattributes", "*.slow filter=slow\n");
        repo.git(&["config", "filter.slow.clean", &format!("sh {}", filter.display())]);
        repo.write("b.slow", "2");
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        assert_eq!(opened.trust, "unknown");
        core.trust_repo(&opened.repo_id).await.unwrap();

        let task = {
            let (core, id) = (core.clone(), opened.repo_id.clone());
            tokio::spawn(async move { run(&core, "main", request(&id, "add-1", ExecKind::Write, "add", &["--", "b.slow"])).await })
        };
        for _ in 0..100 {
            if std::fs::read_to_string(&pgid_file).is_ok_and(|s| !s.trim().is_empty()) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let pgid: i32 = std::fs::read_to_string(&pgid_file).unwrap().trim().parse().unwrap();
        let lock = repo.canonical_root().join(".git/index.lock");
        assert!(lock.exists(), "git add đang giữ index.lock khi chạy bộ lọc");
        // giết cứng cả nhóm (mô phỏng crash / kill -9)
        nix::sys::signal::killpg(nix::unistd::Pid::from_raw(pgid), nix::sys::signal::Signal::SIGKILL).unwrap();
        let (result, sink) = task.await.unwrap();
        result.unwrap();
        let exit = sink.collect().exit.unwrap();
        assert_eq!(exit.code, 128 + 9);
        assert!(!exit.cancelled);
        assert!(lock.exists(), "khoá mồ côi còn lại");
        let (_, sink) = run(&core, "main", request(&opened.repo_id, "next", ExecKind::Write, "add", &["--", "a.txt"])).await;
        assert!(sink.collect().stderr_text().contains("index.lock"), "lệnh ghi kế tiếp thất bại vì khoá");

        // khoá mới tạo chưa bị coi là mồ côi (có thể là git bên ngoài) → làm cũ đi
        assert!(core.repo_health(&opened.repo_id).unwrap().stale_locks.is_empty());
        let file = std::fs::OpenOptions::new().write(true).open(&lock).unwrap();
        file.set_modified(std::time::SystemTime::now() - Duration::from_secs(60)).unwrap();
        let health = core.repo_health(&opened.repo_id).unwrap();
        assert_eq!(health.stale_locks.len(), 1);
        assert!(health.stale_locks[0].path.ends_with("index.lock"));
        core.remove_stale_lock(&opened.repo_id, &health.stale_locks[0].path).unwrap();
        std::fs::write(&pass_flag, "").unwrap();
        let (result, sink) = run(&core, "main", request(&opened.repo_id, "recovered", ExecKind::Write, "add", &["--", "b.slow"])).await;
        result.unwrap();
        assert_eq!(sink.collect().exit.unwrap().code, 0, "sau khi gỡ khoá, repo dùng lại bình thường");
    }

    // Dùng script `#!/bin/sh` làm hook: chỉ chạy trên Unix (Windows kiểm ở CI Windows ở Phase 9).
    #[cfg(unix)]
    #[tokio::test]
    async fn background_fetch_is_refused_when_busy_and_preempted_by_normal_ops() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1");
        repo.commit_all("init");
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        core.trust_repo(&opened.repo_id).await.unwrap();
        let hook = repo.root().join(".git/hooks/pre-commit");
        std::fs::write(&hook, "#!/bin/sh\nsleep 1\n").unwrap();
        make_executable(&hook);
        let writer = {
            let (core, id) = (core.clone(), opened.repo_id.clone());
            tokio::spawn(async move { run(&core, "main", request(&id, "writer", ExecKind::Write, "commit", &["--allow-empty", "-m", "w"])).await })
        };
        tokio::time::sleep(Duration::from_millis(250)).await;
        let mut auto = request(&opened.repo_id, "auto-fetch", ExecKind::Network, "fetch", &["--all"]);
        auto.profile = Some(EnvProfile::Background);
        let (result, sink) = run(&core, "main", auto).await;
        assert_eq!(result.unwrap_err().code(), "busy", "auto-fetch chỉ chạy khi rảnh");
        assert!(sink.frames().is_empty());
        writer.await.unwrap().0.unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn background_write_is_refused_when_busy_instead_of_queueing() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1");
        repo.commit_all("init");
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        core.trust_repo(&opened.repo_id).await.unwrap();
        let hook = repo.root().join(".git/hooks/pre-commit");
        std::fs::write(&hook, "#!/bin/sh\nsleep 1\n").unwrap();
        make_executable(&hook);
        let writer = {
            let (core, id) = (core.clone(), opened.repo_id.clone());
            tokio::spawn(async move { run(&core, "main", request(&id, "writer", ExecKind::Write, "commit", &["--allow-empty", "-m", "w"])).await })
        };
        tokio::time::sleep(Duration::from_millis(250)).await;
        let mut snapshot = request(&opened.repo_id, "snapshot", ExecKind::Write, "write-tree", &[]);
        snapshot.profile = Some(EnvProfile::Background);
        let (result, sink) = run(&core, "main", snapshot).await;
        assert_eq!(result.unwrap_err().code(), "busy", "snapshot không xếp hàng chờ sau thao tác của người dùng");
        assert!(sink.frames().is_empty());
        writer.await.unwrap().0.unwrap();
    }

    #[tokio::test]
    async fn snapshot_commands_pass_the_policy_and_leave_the_real_index_untouched() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1");
        repo.commit_all("init");
        repo.write("a.txt", "2");
        repo.write("moi.txt", "m");
        repo.git(&["config", "commit.gpgSign", "true"]);
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        let id = opened.repo_id.clone();
        let index = core.snapshot_index_prepare(&id, false).await.unwrap();
        let identity: BTreeMap<String, String> = [
            ("GIT_AUTHOR_NAME", "Thaigit"),
            ("GIT_AUTHOR_EMAIL", "snapshot@thaigit.invalid"),
            ("GIT_COMMITTER_NAME", "Thaigit"),
            ("GIT_COMMITTER_EMAIL", "snapshot@thaigit.invalid"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        let step = |op: &str, sub: &str, args: &[&str], env: BTreeMap<String, String>, stdin: Option<&str>| {
            let mut req = request(&id, op, ExecKind::Write, sub, args);
            req.profile = Some(EnvProfile::Background);
            req.env = Some(env);
            req.stdin = stdin.map(|text| BASE64.encode(text));
            req
        };
        let with_index: BTreeMap<String, String> = [("GIT_INDEX_FILE".to_string(), index.clone())].into();
        let stdout = |sink: &Arc<CollectSink>| String::from_utf8(sink.collect().stdout).unwrap().trim().to_string();

        // Index tạm chưa có: `add -A` dựng nó từ đầu (không cần `read-tree`).
        let (result, sink) = run(&core, "main", step("s2", "add", &["-A"], with_index.clone(), None)).await;
        result.unwrap();
        assert_eq!(sink.collect().exit.unwrap().code, 0);
        let (result, sink) = run(&core, "main", step("s3", "write-tree", &[], with_index.clone(), None)).await;
        result.unwrap();
        let tree = stdout(&sink);
        assert_eq!(tree.len(), 40, "{tree}");
        let (result, sink) =
            run(&core, "main", step("s4", "commit-tree", &[&tree, "-p", "HEAD", "--no-gpg-sign", "-F", "-"], identity, Some("thaigit-snapshot v1\n"))).await;
        result.unwrap();
        let commit = stdout(&sink);
        assert_eq!(commit.len(), 40, "{commit}");
        let ref_args = ["--create-reflog", "-m", "thaigit-snapshot", "refs/worktree/thaigit/snapshots", commit.as_str()];
        let (result, _) = run(&core, "main", step("s5", "update-ref", &ref_args, BTreeMap::new(), None)).await;
        result.unwrap();

        assert_eq!(repo.git(&["rev-parse", "refs/worktree/thaigit/snapshots"]).trim(), commit);
        assert_eq!(repo.git(&["show", &format!("{commit}:moi.txt")]), "m", "file chưa track có trong snapshot");
        assert_eq!(repo.git(&["log", "-1", "--format=%an <%ae>", &commit]).trim(), "Thaigit <snapshot@thaigit.invalid>");
        assert_eq!(repo.git(&["status", "--porcelain"]), " M a.txt\n?? moi.txt\n", "index thật không đổi");
    }

    #[tokio::test]
    async fn output_stays_english_when_the_environment_asks_for_another_locale() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1");
        repo.commit_all("init");
        for (index, locale) in ["de_DE.UTF-8", "vi_VN.UTF-8"].into_iter().enumerate() {
            let data = tempfile::tempdir().unwrap();
            let mut env = repo.env();
            env.set("LC_ALL", locale);
            env.set("LANGUAGE", "de:vi");
            env.set("LC_MESSAGES", locale);
            env.set("LANG", locale);
            let core = Core::for_tests(data.path(), env).await;
            let opened = open(&core, &repo).await;
            // Env dựng ra: không còn LC_ALL, ép thông báo tiếng Anh.
            let git = core.locator.current().unwrap();
            let spec = core.build_spec(&git, SpawnOptions { cwd: repo.root(), sub: "status", args: &[], stdin: None, profile: EnvProfile::Background, caller_env: BTreeMap::new(), restrictions: None });
            let env: BTreeMap<String, String> = spec.env.iter().map(|(k, v)| (k.to_string_lossy().into_owned(), v.to_string_lossy().into_owned())).collect();
            assert!(!env.contains_key("LC_ALL"), "{locale}");
            assert_eq!(env["LANGUAGE"], "en");
            assert_eq!(env["LC_MESSAGES"], "C");
            // Thông báo lỗi thật của git (7 chỗ toast khôi phục so khớp chuỗi tiếng Anh).
            let (result, sink) = run(&core, "main", request(&opened.repo_id, &format!("loc-{index}"), ExecKind::Write, "checkout", &["nhanh-khong-ton-tai"])).await;
            result.unwrap();
            let out = sink.collect();
            assert_ne!(out.exit.unwrap().code, 0);
            let text = out.stderr_text();
            assert!(text.contains("did not match any file(s) known to git"), "{locale}: {text}");
        }
    }

    // Dùng script `#!/bin/sh` làm hook: chỉ chạy trên Unix (Windows kiểm ở CI Windows ở Phase 9).
    #[cfg(unix)]
    #[tokio::test]
    async fn session_reset_cancels_network_and_read_ops_but_lets_writes_finish_detached() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1");
        repo.commit_all("init");
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        core.trust_repo(&opened.repo_id).await.unwrap();
        let hook = repo.root().join(".git/hooks/pre-commit");
        let done = repo.tmp().join("hook-finished");
        std::fs::write(&hook, format!("#!/bin/sh\nsleep 1\ntouch '{}'\n", done.display())).unwrap();
        make_executable(&hook);
        let sink = Arc::new(CollectSink::default());
        let detached = Arc::new(AtomicBool::new(false));
        let task = {
            let (core, id, sink, detached) = (core.clone(), opened.repo_id.clone(), sink.clone(), detached.clone());
            tokio::spawn(async move { core.exec_git("win-1", request(&id, "w-reset", ExecKind::Write, "commit", &["--allow-empty", "-m", "x"]), sink, detached).await })
        };
        tokio::time::sleep(Duration::from_millis(300)).await;
        core.reset_window("win-1");
        assert!(detached.load(Ordering::SeqCst), "op ghi bị tách khỏi webview");
        task.await.unwrap().unwrap();
        assert!(done.exists(), "lệnh ghi không bị giết giữa chừng");
        assert!(sink.frames().iter().all(|f| f[0] != crate::frames::TAG_EXIT), "webview mới không nhận frame của phiên cũ");
        assert!(core.ops.is_empty());
    }

    #[tokio::test]
    async fn git_log_of_thirty_thousand_commits_streams_quickly() {
        let repo = TestRepo::new();
        // 30k commit bằng fast-import (nhanh), ~6 MB output với định dạng như app dùng.
        let mut stream = String::new();
        for index in 0..30_000u32 {
            let message = format!("Commit số {index} — thông điệp có tiếng Việt để đo byte");
            stream.push_str(&format!(
                "commit refs/heads/main\nmark :{mark}\ncommitter Thaigit Test <test@example.com> {time} +0000\ndata {len}\n{message}\n",
                mark = index + 1,
                time = 1_700_000_000 + index,
                len = message.len()
            ));
            if index > 0 {
                stream.push_str(&format!("from :{}\n", index));
            }
            stream.push('\n');
        }
        let mut child = repo.command(&["fast-import", "--quiet"]).stdin(std::process::Stdio::piped()).spawn().unwrap();
        {
            use std::io::Write;
            child.stdin.take().unwrap().write_all(stream.as_bytes()).unwrap();
        }
        assert!(child.wait().unwrap().success());
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        let started = Instant::now();
        let (result, sink) = run(
            &core,
            "main",
            request(&opened.repo_id, "log-30k", ExecKind::Read, "log", &["-z", "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%D", "--date-order", "--all"]),
        )
        .await;
        result.unwrap();
        let elapsed = started.elapsed();
        let out = sink.collect();
        assert_eq!(out.exit.unwrap().code, 0);
        assert_eq!(out.stdout.split(|b| *b == 0).filter(|r| !r.is_empty()).count(), 30_000);
        assert!(out.stdout.len() > 4_000_000, "{} byte", out.stdout.len());
        assert!(elapsed < Duration::from_secs(3), "git log 30k commit phía Rust: {elapsed:?} (bản debug)");
        println!("git log 30k commit: {} byte, {} frame, {:?}", out.stdout.len(), out.frame_count, elapsed);
    }

    #[tokio::test]
    async fn fifty_megabytes_through_exec_git_keep_their_sha256() {
        let repo = TestRepo::new();
        let blob: Vec<u8> = (0..52_428_800u64).map(|i| (i.wrapping_mul(2654435761) >> 7) as u8).collect();
        repo.write_bytes("big.bin", &blob);
        let sha = repo.git(&["hash-object", "-w", "big.bin"]).trim().to_string();
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        let (result, sink) = run(&core, "main", request(&opened.repo_id, "blob-50mb", ExecKind::Read, "cat-file", &["blob", &sha])).await;
        result.unwrap();
        let frames = sink.frames();
        assert!(frames.iter().all(|f| f.len() <= 1 + crate::frames::MAX_STDOUT_FRAME));
        assert_eq!(decode_exit_frame(frames.last().unwrap()), Some((0, false)));
        let out = sink.collect();
        assert_eq!(out.stdout.len(), blob.len());
        assert_eq!(Sha256::digest(&out.stdout), Sha256::digest(&blob));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn background_profile_denies_credential_prompts_and_interactive_profile_never_prompts_yet() {
        let repo = TestRepo::new();
        let data = tempfile::tempdir().unwrap();
        let called = repo.tmp().join("askpass-called");
        let fake_exe = repo.tmp().join("thaigit-fake");
        std::fs::write(&fake_exe, format!("#!/bin/sh\necho \"$@\" >> '{}'\nexit 1\n", called.display())).unwrap();
        make_executable(&fake_exe);
        let wrapper = crate::askpass::prepare_deny_program(data.path(), &fake_exe);
        let core = Core::for_tests_with(data.path(), repo.env(), wrapper).await;
        let opened = open(&core, &repo).await;
        let entry = core.registry.get(&opened.repo_id).unwrap();
        let query = "protocol=https\nhost=example.com\n\n".as_bytes().to_vec();
        let run_credential = |profile: EnvProfile| {
            let core = core.clone();
            let entry = entry.clone();
            let query = query.clone();
            async move {
                core.run_git(
                    SpawnOptions {
                        cwd: &entry.root,
                        sub: "credential",
                        args: &["fill".to_string()],
                        stdin: Some(query),
                        profile,
                        caller_env: BTreeMap::new(),
                        restrictions: None,
                    },
                    Some(Duration::from_secs(20)),
                )
                .await
                .unwrap()
            }
        };
        let started = Instant::now();
        let output = run_credential(EnvProfile::Background).await;
        assert_ne!(output.exit.code, 0, "không có thông tin đăng nhập: git thất bại, không treo, không bật cửa sổ");
        assert!(started.elapsed() < Duration::from_secs(10));
        let log = std::fs::read_to_string(&called).expect("git gọi askpass từ chối của app");
        assert!(log.contains("--askpass-deny"), "script bọc gọi lại exe với cờ từ chối: {log}");
        std::fs::remove_file(&called).unwrap();
        // Lệnh interactive không có phiên askpass (vd. lệnh nội bộ) → git không có chỗ nào để hỏi, thất bại nhanh
        let output = run_credential(EnvProfile::Interactive).await;
        assert_ne!(output.exit.code, 0);
        assert!(!called.exists());
    }

    /// Askpass tương tác đầu-cuối với git thật: `git credential fill` (không helper nào) hỏi tên rồi mật khẩu qua askpass;
    /// "tiến trình askpass" là script bash nói đúng giao thức của `askpass::run_client` qua /dev/tcp.
    #[cfg(unix)]
    #[tokio::test]
    async fn interactive_askpass_answers_git_credential_prompts_through_the_window() {
        use crate::askpass::{AskpassEvents, AskpassRequestEvent, AskpassServer};
        struct AutoAnswer(std::sync::Mutex<Vec<AskpassRequestEvent>>, std::sync::OnceLock<Arc<AskpassServer>>);
        impl AskpassEvents for AutoAnswer {
            fn request(&self, window: &str, event: &AskpassRequestEvent) {
                self.0.lock().unwrap().push(event.clone());
                let answer = if event.kind == "username" { "thai" } else { "mat khau bi mat" };
                let server = self.1.get().unwrap().clone();
                let (window, id) = (window.to_string(), event.request_id.clone());
                std::thread::spawn(move || server.reply(&window, &id, Some(answer.to_string())).unwrap());
            }
            fn closed(&self, _: &str, _: &str) {}
        }
        let repo = TestRepo::new();
        let data = tempfile::tempdir().unwrap();
        let client = repo.tmp().join("askpass-client.sh");
        std::fs::write(
            &client,
            "#!/bin/bash\nexec 3<>\"/dev/tcp/127.0.0.1/$THAIGIT_ASKPASS_PORT\" || exit 1\nprintf '{\"token\":\"%s\",\"prompt\":\"%s\"}\\n' \"$THAIGIT_ASKPASS_TOKEN\" \"$1\" >&3\nIFS= read -r line <&3\ncase \"$line\" in *'\"answer\":\"'*) a=${line#*\\\"answer\\\":\\\"}; printf '%s\\n' \"${a%\\\"\\}*}\";; *) exit 1;; esac\n",
        )
        .unwrap();
        make_executable(&client);
        let events = Arc::new(AutoAnswer(Default::default(), Default::default()));
        let server = AskpassServer::start(client.clone().into_os_string(), events.clone()).unwrap();
        let _ = events.1.set(server.clone());
        let core = Core::for_tests_with(data.path(), repo.env(), None).await;
        let opened = open(&core, &repo).await;
        let entry = core.registry.get(&opened.repo_id).unwrap();
        let git = core.require_git("credential").unwrap();
        let session = server.session("main", "op-cred", "git credential");
        let spec = core.build_spec_with(
            &git,
            SpawnOptions {
                cwd: &entry.root,
                sub: "credential",
                args: &["fill".to_string()],
                stdin: Some(b"protocol=https\nhost=example.com\n\n".to_vec()),
                profile: EnvProfile::Interactive,
                caller_env: BTreeMap::new(),
                restrictions: None,
            },
            Some(&session),
            None,
        );
        let output = core.run_spec(spec, Some(Duration::from_secs(20))).await.unwrap();
        assert_eq!(output.exit.code, 0, "{}", output.stderr());
        let stdout = output.stdout();
        assert!(stdout.contains("username=thai\n"), "{stdout}");
        assert!(stdout.contains("password=mat khau bi mat\n"), "{stdout}");
        let asked: Vec<(&str, Option<String>)> = events.0.lock().unwrap().iter().map(|e| (e.kind, e.host.clone())).collect();
        assert_eq!(asked, vec![("username", Some("example.com".into())), ("password", Some("example.com".into()))]);
        drop(session);
    }

    // --- `diff --no-index` qua symlink do chính repo tạo ra ----------------------------------------------------------------

    /// Repo + một thư mục NGOÀI repo chứa `passwd`, và symlink `linkdir` (→ thư mục ngoài) / `linkfile` (→ file ngoài) được tạo
    /// bằng `apply` với patch mode 120000 — đúng cách mô tả trong báo cáo đánh giá.
    #[cfg(unix)]
    async fn repo_with_outside_symlinks() -> (TestRepo, Arc<Core>, tempfile::TempDir, String) {
        let repo = TestRepo::new();
        repo.write("base", "base\n");
        repo.write("passwd", "local\n");
        repo.commit_all("init");
        let outside = repo.tmp().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("passwd"), "TOP-SECRET-OUTSIDE\n").unwrap();
        let (core, data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        let symlink_patch = |name: &str, target: &Path| {
            format!("diff --git a/{name} b/{name}\nnew file mode 120000\n--- /dev/null\n+++ b/{name}\n@@ -0,0 +1 @@\n+{}\n\\ No newline at end of file\n", target.display())
        };
        let patch = format!("{}{}", symlink_patch("linkdir", &outside), symlink_patch("linkfile", &outside.join("passwd")));
        let mut apply = request(&opened.repo_id, "make-links", ExecKind::Write, "apply", &["-"]);
        apply.stdin = Some(BASE64.encode(patch.as_bytes()));
        let (result, sink) = run(&core, "main", apply).await;
        result.unwrap();
        let out = sink.collect();
        assert_eq!(out.exit.unwrap().code, 0, "{}", out.stderr_text());
        assert!(repo.root().join("linkdir").is_symlink() && repo.root().join("linkfile").is_symlink());
        (repo, core, data, opened.repo_id)
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn diff_no_index_cannot_read_outside_files_through_a_symlink_the_repo_created() {
        let (repo, core, _data, id) = repo_with_outside_symlinks().await;
        // đối chứng: git trần đọc được file ngoài repo qua symlink (cả hai dạng)
        let (_, through_parent, _) = repo.git_raw(&["diff", "--no-index", "--", "base", "linkdir/passwd"]);
        assert!(through_parent.contains("TOP-SECRET-OUTSIDE"), "đối chứng: {through_parent}");
        let (_, through_leaf, _) = repo.git_raw(&["diff", "--no-index", "--", "passwd", "linkdir"]);
        assert!(through_leaf.contains("TOP-SECRET-OUTSIDE"), "đối chứng (ghép thư mục với file): {through_leaf}");

        for (index, args) in [
            vec!["--no-index", "--", "base", "linkdir/passwd"],
            vec!["--no-index", "--", "/dev/null", "linkdir/passwd"],
            vec!["--no-color", "-U3", "--no-index", "--", "linkdir/passwd", "base"],
            // phần tử cuối là symlink tới THƯ MỤC: git `stat` (đi theo) khi ghép thư mục với file có cùng tên `passwd`
            vec!["--no-index", "--", "passwd", "linkdir"],
            vec!["--no-index", "--", "passwd", "linkdir/"],
            vec!["--no-index", "--", "linkdir", "passwd"],
            // thư mục cha không tồn tại phía sau symlink vẫn đi qua symlink
            vec!["--no-index", "--", "base", "linkdir/not/there"],
            // .git không đọc được qua đường diff
            vec!["--no-index", "--", "/dev/null", ".git/config"],
            vec!["--no-index", "--", "/dev/null", ".GIT/config"],
            // diff thường cũng không đi qua symlink của repo
            vec!["--", "linkdir/passwd"],
        ]
        .into_iter()
        .enumerate()
        {
            let (result, sink) = run(&core, "main", request(&id, &format!("atk-{index}"), ExecKind::Read, "diff", &args)).await;
            let error = result.expect_err(&format!("diff {args:?} phải bị chặn"));
            assert_eq!(error.code(), "out-of-scope", "diff {args:?}: {error}");
            assert!(sink.frames().is_empty(), "không có frame nào khi bị chặn: {args:?}");
        }
        assert!(core.ops.is_empty());

        // Dùng hợp lệ vẫn chạy: file chưa track so với /dev/null (như app), và symlink tới FILE ngoài chỉ cho thấy chuỗi đích.
        for (op, args) in [
            ("ok-1", vec!["--no-index", "--no-color", "--", "/dev/null", "base"]),
            ("ok-2", vec!["--no-index", "--no-color", "--", "/dev/null", "linkfile"]),
            ("ok-3", vec!["--no-index", "--no-color", "--", "base", "passwd"]),
        ] {
            let (result, sink) = run(&core, "main", request(&id, op, ExecKind::Read, "diff", &args)).await;
            result.unwrap_or_else(|e| panic!("{args:?}: {e}"));
            let out = sink.collect();
            assert_eq!(out.exit.unwrap().code, 1, "{args:?}: {}", out.stderr_text());
            assert!(!out.stdout_text().contains("TOP-SECRET-OUTSIDE"), "{args:?}: {}", out.stdout_text());
        }
        let (_, sink) = run(&core, "main", request(&id, "ok-4", ExecKind::Read, "diff", &["--no-index", "--no-color", "--", "/dev/null", "linkfile"])).await;
        assert!(sink.collect().stdout_text().contains("passwd"), "symlink tới file hiện chuỗi đích, không phải nội dung");
        // diff thường theo pathspec bình thường
        let (result, _) = run(&core, "main", request(&id, "ok-5", ExecKind::Read, "diff", &["--cached", "--", "base"])).await;
        result.unwrap();
        // revision không bị coi nhầm là đường dẫn vượt phạm vi
        let (result, sink) = run(&core, "main", request(&id, "ok-6", ExecKind::Read, "diff", &["HEAD~0", "HEAD", "--", "base"])).await;
        result.unwrap();
        assert_eq!(sink.collect().exit.unwrap().code, 0);
    }

    // Dùng hook `#!/bin/sh` chậm để giữ khoá ghi: chỉ chạy trên Unix.
    #[cfg(unix)]
    #[tokio::test]
    async fn diff_no_index_takes_the_repo_lock_so_no_write_can_plant_a_symlink_between_check_and_read() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1");
        repo.commit_all("init");
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        core.trust_repo(&opened.repo_id).await.unwrap();
        let hook = repo.root().join(".git/hooks/pre-commit");
        std::fs::write(&hook, "#!/bin/sh\nsleep 1\n").unwrap();
        make_executable(&hook);
        let writer = {
            let (core, id) = (core.clone(), opened.repo_id.clone());
            tokio::spawn(async move { run(&core, "main", request(&id, "writer", ExecKind::Write, "commit", &["--allow-empty", "-m", "w"])).await })
        };
        tokio::time::sleep(Duration::from_millis(300)).await;
        // diff thường là lệnh đọc: không chờ (xong khi lệnh ghi — giữ khoá ≥ 1 s — còn đang chạy)
        let (result, _) = run(&core, "main", request(&opened.repo_id, "d-plain", ExecKind::Read, "diff", &["--cached", "--", "a.txt"])).await;
        result.unwrap();
        assert!(!writer.is_finished(), "diff thường không chờ khoá của lệnh ghi");
        // `--no-index` đọc qua hệ thống file nên xếp hàng sau lệnh ghi đang chạy
        let started = Instant::now();
        let (result, sink) = run(&core, "main", request(&opened.repo_id, "d-no-index", ExecKind::Read, "diff", &["--no-index", "--no-color", "--", "/dev/null", "a.txt"])).await;
        result.unwrap();
        assert!(started.elapsed() >= Duration::from_millis(450), "phải chờ lệnh ghi xong: {:?}", started.elapsed());
        assert_eq!(sink.collect().exit.unwrap().code, 1);
        writer.await.unwrap().0.unwrap();
    }

    // --- giới hạn output (không có backpressure thật từ webview) ----------------------------------------------------------

    #[tokio::test]
    async fn output_past_the_limit_stops_the_command_with_a_clear_error_and_no_orphan() {
        let repo = TestRepo::new();
        let blob: Vec<u8> = (0..3_000_000u32).map(|i| (i % 251) as u8).collect();
        repo.write_bytes("big.bin", &blob);
        let sha = repo.git(&["hash-object", "-w", "big.bin"]).trim().to_string();
        let data = tempfile::tempdir().unwrap();
        let limit = 1024 * 1024;
        let core = Core::for_tests_limited(data.path(), repo.env(), None, (limit, 512 * 1024)).await;
        let opened = open(&core, &repo).await;
        let (result, sink) = run(&core, "main", request(&opened.repo_id, "big", ExecKind::Read, "cat-file", &["blob", &sha])).await;
        let error = result.expect_err("output 3 MB vượt giới hạn 1 MiB");
        assert_eq!(error.code(), "io");
        assert!(error.to_string().contains("vượt giới hạn"), "{error}");
        let out = sink.collect();
        assert!(out.stdout.len() as u64 <= limit, "phần vượt giới hạn bị bỏ: {} byte", out.stdout.len());
        assert!(out.exit.is_none(), "không có frame exit — lệnh trả lỗi");
        assert!(core.ops.is_empty());
        // lệnh dưới giới hạn vẫn chạy bình thường, khoá không bị kẹt
        let (result, sink) = run(&core, "main", request(&opened.repo_id, "small", ExecKind::Write, "rev-parse", &["--git-dir"])).await;
        result.unwrap();
        assert_eq!(sink.collect().exit.unwrap().code, 0);

        // bộ gom của lệnh git nội bộ cũng có trần
        let entry = core.registry.get(&opened.repo_id).unwrap();
        let args = vec!["blob".to_string(), sha.clone()];
        let internal = core
            .run_git(
                SpawnOptions { cwd: &entry.root, sub: "cat-file", args: &args, stdin: None, profile: EnvProfile::Background, caller_env: BTreeMap::new(), restrictions: None },
                Some(Duration::from_secs(30)),
            )
            .await;
        let error = internal.err().expect("trần của bộ gom nội bộ");
        assert_eq!((error.code(), error.to_string().contains("vượt giới hạn")), ("io", true), "{error}");
        // dưới trần thì gom đủ
        let small = core.git_plain(&entry.root, "rev-parse", &["--git-dir"], None).await.unwrap();
        assert_eq!(small.stdout().trim(), ".git");
    }
}
