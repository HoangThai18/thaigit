//! Askpass — hai chế độ:
//!  - TỪ CHỐI (hồ sơ `background`, tự fetch: không bao giờ bật cửa sổ đăng nhập): `main()` kiểm `--askpass-deny` TRƯỚC khi dựng
//!    Tauri và thoát mã 1, không in gì.
//!  - TƯƠNG TÁC (hồ sơ `interactive`: fetch / pull / push / clone do người dùng bấm): hỏi trong app (xem phần dưới).
//!
//! Lựa chọn thiết kế: git/ssh chạy `GIT_ASKPASS`/`SSH_ASKPASS` như MỘT đường dẫn chương trình (không qua shell, không tách
//! đối số), nên `<exe> --askpass-deny` không đặt thẳng vào env được.
//!  - macOS/Linux: ghi một script `#!/bin/sh` nhỏ vào thư mục dữ liệu (`askpass-deny.sh`) rồi `exec <exe> --askpass-deny`;
//!    script được ghi lại mỗi lần khởi động nếu nội dung đổi (app chuyển chỗ/cập nhật).
//!  - Windows: `GIT_ASKPASS` trỏ thẳng vào `<exe>`; git gọi `<exe> "<prompt>"` nên argv[1] là câu hỏi, không phải cờ —
//!    vì vậy chính sách đặt thêm biến `THAIGIT_ASKPASS_DENY=1` (`policy::ASKPASS_DENY_ENV`) và `main()` coi biến đó cũng là
//!    lời gọi từ chối.

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};

use crate::errors::{AppError, Result};
use crate::policy::ASKPASS_DENY_ENV;

pub const DENY_FLAG: &str = "--askpass-deny";

/// Tiến trình này đang được git/ssh gọi làm askpass từ chối? (argv[1] là cờ, hoặc biến đánh dấu của hồ sơ background.)
pub fn is_deny_invocation(args: &[OsString], marker: Option<OsString>) -> bool {
    args.get(1).is_some_and(|arg| arg == DENY_FLAG) || marker.is_some_and(|value| value == "1")
}

/// Điểm vào sớm của `main()`: trả `true` nếu phải thoát ngay (mã 1, không in gì).
pub fn should_exit_early() -> bool {
    let args: Vec<OsString> = std::env::args_os().collect();
    is_deny_invocation(&args, std::env::var_os(ASKPASS_DENY_ENV))
}

// --- Askpass tương tác (hồ sơ `interactive`) ------------------------------------------------------------------------------
//
// git/ssh cần tên đăng nhập / mật khẩu / passphrase mà không có credential helper nào trả lời → chạy `GIT_ASKPASS`/`SSH_ASKPASS`
// = chính exe của app (Unix: qua script bọc `askpass.sh`). Tiến trình đó (`run_client`) kết nối 127.0.0.1:<cổng> của app, gửi
// token RIÊNG của lệnh đang chạy + câu hỏi; app phát `askpass-request` tới ĐÚNG cửa sổ sở hữu lệnh, chờ `askpass_reply`, gửi câu
// trả lời về cho tiến trình askpass in ra stdout. Token chỉ nằm trong env của tiến trình git đó và hết hạn khi lệnh xong; không
// bao giờ log câu hỏi / câu trả lời.

/// Cờ của script bọc (Unix): `<exe> --askpass "<câu hỏi>"`.
pub const CLIENT_FLAG: &str = "--askpass";
/// Windows: `GIT_ASKPASS` trỏ thẳng vào exe (git gọi `<exe> "<câu hỏi>"`), biến này đánh dấu lời gọi askpass.
pub const CLIENT_ENV: &str = "THAIGIT_ASKPASS";
pub const PORT_ENV: &str = "THAIGIT_ASKPASS_PORT";
pub const TOKEN_ENV: &str = "THAIGIT_ASKPASS_TOKEN";

const MAX_LINE_BYTES: usize = 16 * 1024;
const MAX_PROMPT_CHARS: usize = 4096;
const MAX_ANSWER_BYTES: usize = 8 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(5);
/// Người dùng có chừng này thời gian để trả lời; quá hạn thì coi như Huỷ (git nhận lỗi, không treo mãi).
const ANSWER_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// Khớp `AskpassRequestEvent` ở TS.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskpassRequestEvent {
    pub request_id: String,
    pub op_id: String,
    pub operation: String,
    pub kind: &'static str,
    pub host: Option<String>,
    pub prompt: String,
}

/// Khớp `AskpassClosedEvent` ở TS: câu hỏi hết hiệu lực (lệnh đã xong / bị huỷ / quá hạn) — đóng hộp thoại.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskpassClosedEvent {
    pub request_id: String,
}

/// Đẩy sự kiện tới cửa sổ (Tauri `emit_to`) — tách ra để test không cần cửa sổ.
pub trait AskpassEvents: Send + Sync {
    fn request(&self, window: &str, event: &AskpassRequestEvent);
    fn closed(&self, window: &str, request_id: &str);
}

struct TauriAskpassEvents<R: Runtime>(AppHandle<R>);

impl<R: Runtime> AskpassEvents for TauriAskpassEvents<R> {
    fn request(&self, window: &str, event: &AskpassRequestEvent) {
        let _ = self.0.emit_to(window, "askpass-request", event);
    }

    fn closed(&self, window: &str, request_id: &str) {
        let _ = self.0.emit_to(window, "askpass-closed", AskpassClosedEvent { request_id: request_id.to_string() });
    }
}

#[derive(Deserialize, Serialize)]
struct ClientRequest {
    token: String,
    prompt: String,
}

#[derive(Deserialize, Serialize)]
struct ClientResponse {
    answer: Option<String>,
}

struct SessionInfo {
    window: String,
    op_id: String,
    operation: String,
}

struct PendingRequest {
    window: String,
    token: String,
    reply: tokio::sync::oneshot::Sender<Option<String>>,
}

pub struct AskpassServer {
    port: u16,
    program: OsString,
    sessions: Mutex<HashMap<String, SessionInfo>>,
    pending: Mutex<HashMap<String, PendingRequest>>,
    events: Arc<dyn AskpassEvents>,
}

/// Askpass của MỘT lệnh git: env cho tiến trình git; hết phạm vi (lệnh xong) thì token hết hạn và câu hỏi đang chờ bị huỷ.
pub struct AskpassSession {
    server: Arc<AskpassServer>,
    token: String,
}

impl AskpassSession {
    /// Biến môi trường thêm vào tiến trình git (ngoài `GIT_ASKPASS`/`SSH_ASKPASS` do chính sách đặt).
    pub fn env(&self) -> Vec<(String, String)> {
        let mut env = vec![(PORT_ENV.to_string(), self.server.port.to_string()), (TOKEN_ENV.to_string(), self.token.clone())];
        if cfg!(windows) {
            env.push((CLIENT_ENV.to_string(), "1".to_string()));
        }
        env
    }

    pub fn program(&self) -> &OsString {
        &self.server.program
    }
}

impl Drop for AskpassSession {
    fn drop(&mut self) {
        self.server.sessions.lock().unwrap_or_else(|p| p.into_inner()).remove(&self.token);
        let closed: Vec<(String, String)> = {
            let mut pending = self.server.pending.lock().unwrap_or_else(|p| p.into_inner());
            let ids: Vec<String> = pending.iter().filter(|(_, request)| request.token == self.token).map(|(id, _)| id.clone()).collect();
            // Bỏ sender → tiến trình askpass nhận "huỷ".
            ids.into_iter().filter_map(|id| pending.remove(&id).map(|request| (request.window, id))).collect()
        };
        for (window, id) in closed {
            self.server.events.closed(&window, &id);
        }
    }
}

fn random_token() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

/// Phân loại câu hỏi của git/ssh + lấy host để hộp thoại ghi rõ "đăng nhập vào đâu".
pub fn classify(prompt: &str) -> (&'static str, Option<String>) {
    let lower = prompt.to_lowercase();
    let kind = if lower.starts_with("username") {
        "username"
    } else if lower.contains("passphrase") {
        "passphrase"
    } else if lower.contains("password") || lower.contains("pin for") {
        "password"
    } else {
        "other"
    };
    // git: "Username for 'https://github.com': ", "Password for 'https://user@github.com': "
    let quoted = prompt.split('\'').nth(1).and_then(|inside| url::Url::parse(inside).ok()).and_then(|url| url.host_str().map(str::to_string));
    // ssh: "user@host's password: "
    let ssh = || {
        let before = prompt.split("'s password").next()?;
        let host = before.rsplit('@').next()?;
        (before.contains('@') && !host.is_empty() && !host.contains(char::is_whitespace)).then(|| host.to_string())
    };
    (kind, quoted.or_else(ssh))
}

/// Câu hỏi hiển thị được: không rỗng quá dài, không có ký tự điều khiển (trừ xuống dòng / tab — câu hỏi khoá host của ssh nhiều dòng).
fn valid_prompt(prompt: &str) -> bool {
    prompt.chars().count() <= MAX_PROMPT_CHARS && !prompt.chars().any(|c| c.is_control() && c != '\n' && c != '\t' && c != '\r')
}

impl AskpassServer {
    /// Mở listener 127.0.0.1:<cổng ngẫu nhiên> và vòng nhận kết nối.
    pub fn start(program: OsString, events: Arc<dyn AskpassEvents>) -> std::io::Result<Arc<Self>> {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        let server = Arc::new(Self { port, program, sessions: Mutex::default(), pending: Mutex::default(), events });
        let weak = Arc::downgrade(&server);
        tauri::async_runtime::spawn(async move {
            let Ok(listener) = tokio::net::TcpListener::from_std(listener) else { return };
            while let Ok((stream, peer)) = listener.accept().await {
                if !peer.ip().is_loopback() {
                    continue;
                }
                let Some(server) = weak.upgrade() else { break };
                tauri::async_runtime::spawn(async move { server.handle(stream).await });
            }
        });
        Ok(server)
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    /// Phiên askpass cho một lệnh git của cửa sổ `window`.
    pub fn session(self: &Arc<Self>, window: &str, op_id: &str, operation: &str) -> AskpassSession {
        let token = random_token();
        self.sessions.lock().unwrap_or_else(|p| p.into_inner()).insert(
            token.clone(),
            SessionInfo { window: window.to_string(), op_id: op_id.to_string(), operation: operation.to_string() },
        );
        AskpassSession { server: self.clone(), token }
    }

    async fn handle(self: Arc<Self>, stream: tokio::net::TcpStream) {
        let (read, mut write) = stream.into_split();
        let mut reader = tokio::io::BufReader::new(read.take(MAX_LINE_BYTES as u64));
        let mut line = String::new();
        let request = match tokio::time::timeout(READ_TIMEOUT, reader.read_line(&mut line)).await {
            Ok(Ok(n)) if n > 0 => serde_json::from_str::<ClientRequest>(line.trim_end()).ok(),
            _ => None,
        };
        let answer = match request {
            Some(request) if valid_prompt(&request.prompt) => self.ask(request).await,
            _ => None,
        };
        let mut response = serde_json::to_string(&ClientResponse { answer }).unwrap_or_else(|_| "{}".into());
        response.push('\n');
        let _ = write.write_all(response.as_bytes()).await;
        let _ = write.shutdown().await;
    }

    async fn ask(&self, request: ClientRequest) -> Option<String> {
        let (window, event) = {
            let sessions = self.sessions.lock().unwrap_or_else(|p| p.into_inner());
            let session = sessions.get(&request.token)?;
            let (kind, host) = classify(&request.prompt);
            let event = AskpassRequestEvent {
                request_id: uuid::Uuid::new_v4().simple().to_string(),
                op_id: session.op_id.clone(),
                operation: session.operation.clone(),
                kind,
                host,
                prompt: request.prompt.trim_end().to_string(),
            };
            (session.window.clone(), event)
        };
        let (sender, receiver) = tokio::sync::oneshot::channel();
        self.pending.lock().unwrap_or_else(|p| p.into_inner()).insert(
            event.request_id.clone(),
            PendingRequest { window: window.clone(), token: request.token, reply: sender },
        );
        self.events.request(&window, &event);
        match tokio::time::timeout(ANSWER_TIMEOUT, receiver).await {
            Ok(Ok(answer)) => answer,
            // Phiên đã đóng (lệnh xong / bị huỷ): Drop của phiên đã báo `askpass-closed`.
            Ok(Err(_)) => None,
            Err(_) => {
                if self.pending.lock().unwrap_or_else(|p| p.into_inner()).remove(&event.request_id).is_some() {
                    self.events.closed(&window, &event.request_id);
                }
                None
            }
        }
    }

    /// Câu trả lời từ webview: chỉ cửa sổ đã nhận câu hỏi mới trả lời được; `None` = Huỷ.
    pub fn reply(&self, window: &str, request_id: &str, answer: Option<String>) -> Result<()> {
        if answer.as_ref().is_some_and(|a| a.len() > MAX_ANSWER_BYTES || a.contains(['\n', '\r', '\0'])) {
            return Err(AppError::policy("Câu trả lời không hợp lệ"));
        }
        let mut pending = self.pending.lock().unwrap_or_else(|p| p.into_inner());
        if pending.get(request_id).is_none_or(|request| request.window != window) {
            return Err(AppError::NotFound("Câu hỏi đăng nhập không còn hiệu lực".into()));
        }
        let request = pending.remove(request_id).expect("vừa kiểm");
        let _ = request.reply.send(answer);
        Ok(())
    }
}

/// Khởi tạo lúc `setup` (sau `app.manage(core)`): script bọc (Unix), listener 127.0.0.1, gắn vào `Core`.
pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let Some(core) = app.try_state::<Arc<crate::core::Core>>() else { return Ok(()) };
    let Some(program) = std::env::current_exe().ok().and_then(|exe| prepare_client_program(&core.data_dir, &exe)) else {
        return Ok(());
    };
    let server = AskpassServer::start(program, Arc::new(TauriAskpassEvents(app.clone())))
        .map_err(|error| AppError::Io(format!("askpass: {error}")))?;
    let _ = core.askpass.set(server);
    Ok(())
}

/// `askpass_reply`: webview (cửa sổ `window`) trả lời yêu cầu `request_id`; `answer = None` = người dùng huỷ.
/// `request_id` không tồn tại / không thuộc `window` → lỗi (không đoán).
pub fn reply<R: Runtime>(app: &AppHandle<R>, window: &str, request_id: &str, answer: Option<String>) -> Result<()> {
    let server = app.try_state::<Arc<crate::core::Core>>().and_then(|core| core.askpass.get().cloned());
    match server {
        Some(server) => server.reply(window, request_id, answer),
        None => Err(AppError::NotFound("Câu hỏi đăng nhập không còn hiệu lực".into())),
    }
}

// --- Tiến trình askpass (git/ssh gọi) ---------------------------------------------------------------------------------

/// Tiến trình này đang được git/ssh gọi làm askpass tương tác?
pub fn is_client_invocation(args: &[OsString], marker: Option<OsString>) -> bool {
    args.get(1).is_some_and(|arg| arg == CLIENT_FLAG) || marker.is_some_and(|value| value == "1")
}

/// Điểm vào sớm của `main()`: `Some(mã thoát)` nếu tiến trình này là askpass tương tác (đã trả lời xong).
pub fn client_exit_code() -> Option<i32> {
    let args: Vec<OsString> = std::env::args_os().collect();
    if !is_client_invocation(&args, std::env::var_os(CLIENT_ENV)) {
        return None;
    }
    let prompt = if args.get(1).is_some_and(|arg| arg == CLIENT_FLAG) { args.get(2) } else { args.get(1) };
    let prompt = prompt.map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let port = std::env::var(PORT_ENV).ok().and_then(|p| p.parse::<u16>().ok());
    let token = std::env::var(TOKEN_ENV).ok();
    let (Some(port), Some(token)) = (port, token) else { return Some(1) };
    match ask_server(port, &token, &prompt) {
        Some(answer) => {
            let mut stdout = std::io::stdout().lock();
            let ok = writeln!(stdout, "{answer}").and_then(|()| stdout.flush()).is_ok();
            Some(if ok { 0 } else { 1 })
        }
        None => Some(1),
    }
}

/// Hỏi app qua 127.0.0.1; `None` = huỷ / lỗi.
pub fn ask_server(port: u16, token: &str, prompt: &str) -> Option<String> {
    let mut stream = TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, port)), Duration::from_secs(3)).ok()?;
    stream.set_read_timeout(Some(ANSWER_TIMEOUT + Duration::from_secs(30))).ok()?;
    let mut request = serde_json::to_string(&ClientRequest { token: token.to_string(), prompt: prompt.to_string() }).ok()?;
    request.push('\n');
    stream.write_all(request.as_bytes()).ok()?;
    let mut line = String::new();
    BufReader::new(std::io::Read::take(stream, MAX_LINE_BYTES as u64)).read_line(&mut line).ok()?;
    serde_json::from_str::<ClientResponse>(line.trim_end()).ok()?.answer
}

/// Nội dung script bọc askpass tương tác (Unix).
pub fn client_script(exe: &Path) -> String {
    let quoted = format!("'{}'", exe.to_string_lossy().replace('\'', r"'\''"));
    format!("#!/bin/sh\n# Thaigit: hỏi tên đăng nhập / mật khẩu / passphrase trong app cho GIT_ASKPASS/SSH_ASKPASS.\nexec {quoted} {CLIENT_FLAG} \"$@\"\n")
}

/// Chương trình cho `<askpass>`: Unix = script bọc trong thư mục dữ liệu; Windows = chính exe của app.
pub fn prepare_client_program(data_dir: &Path, exe: &Path) -> Option<OsString> {
    write_program(data_dir, "askpass.sh", &client_script(exe), exe)
}

fn write_program(data_dir: &Path, name: &str, script: &str, exe: &Path) -> Option<OsString> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = exe;
        let path = data_dir.join(name);
        let current = std::fs::read_to_string(&path).ok();
        let executable = std::fs::metadata(&path).is_ok_and(|m| m.permissions().mode() & 0o111 != 0);
        if current.as_deref() != Some(script) || !executable {
            crate::store::write_atomic(&path, script.as_bytes()).ok()?;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).ok()?;
        }
        Some(path.into_os_string())
    }
    #[cfg(not(unix))]
    {
        let _ = (data_dir, name, script);
        Some(exe.as_os_str().to_os_string())
    }
}

/// Nội dung script bọc (Unix).
pub fn wrapper_script(exe: &Path) -> String {
    let quoted = format!("'{}'", exe.to_string_lossy().replace('\'', r"'\''"));
    format!(
        "#!/bin/sh\n# Thaigit: trả lời \"từ chối\" cho GIT_ASKPASS/SSH_ASKPASS của lệnh chạy nền (không bao giờ bật hộp thoại).\n[ -x {quoted} ] && exec {quoted} {DENY_FLAG}\nexit 1\n"
    )
}

/// Chương trình cho `<askpass-deny>`: Unix = script bọc trong thư mục dữ liệu; Windows = chính exe của app.
pub fn prepare_deny_program(data_dir: &Path, exe: &Path) -> Option<OsString> {
    write_program(data_dir, "askpass-deny.sh", &wrapper_script(exe), exe)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<OsString> {
        list.iter().map(OsString::from).collect()
    }

    #[test]
    fn recognises_both_the_flag_and_the_environment_marker() {
        assert!(is_deny_invocation(&args(&["thaigit", "--askpass-deny"]), None));
        assert!(is_deny_invocation(&args(&["thaigit", "--askpass-deny", "Username for 'https://x': "]), None));
        // Windows: git chạy `<exe> "<prompt>"`
        assert!(is_deny_invocation(&args(&["thaigit.exe", "Username for 'https://github.com': "]), Some("1".into())));
        assert!(!is_deny_invocation(&args(&["thaigit"]), None));
        assert!(!is_deny_invocation(&args(&["thaigit", "/path/to/repo"]), None));
        assert!(!is_deny_invocation(&args(&["thaigit", "--other"]), Some("0".into())));
        assert!(!is_deny_invocation(&[], None));
    }

    #[test]
    fn without_a_core_init_is_a_no_op_and_replies_find_nothing() {
        let app = tauri::test::mock_app();
        assert!(init(app.handle()).is_ok());
        assert_eq!(reply(app.handle(), "main", "req-1", None).unwrap_err().code(), "not-found");
    }

    #[test]
    fn recognises_the_interactive_client_flag_and_marker() {
        assert!(is_client_invocation(&args(&["thaigit", "--askpass", "Password: "]), None));
        assert!(is_client_invocation(&args(&["thaigit.exe", "Username for 'https://github.com': "]), Some("1".into())));
        assert!(!is_client_invocation(&args(&["thaigit", "--askpass-deny"]), None));
        assert!(!is_client_invocation(&args(&["thaigit", "/repo"]), None));
    }

    #[test]
    fn classifies_git_and_ssh_prompts() {
        assert_eq!(classify("Username for 'https://github.com': "), ("username", Some("github.com".into())));
        assert_eq!(classify("Password for 'https://thai@gitlab.example.vn': "), ("password", Some("gitlab.example.vn".into())));
        assert_eq!(classify("Enter passphrase for key '/Users/t/.ssh/id_ed25519': "), ("passphrase", None));
        assert_eq!(classify("git@ssh.example.com's password: "), ("password", Some("ssh.example.com".into())));
        let host_key = "The authenticity of host 'github.com (140.82.112.3)' can't be established.\nED25519 key fingerprint is SHA256:x.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? ";
        assert_eq!(classify(host_key).0, "other");
    }

    /// Ghi lại sự kiện thay cho Tauri.
    #[derive(Default)]
    struct Recorder {
        requests: Mutex<Vec<(String, AskpassRequestEvent)>>,
        closed: Mutex<Vec<(String, String)>>,
    }

    impl AskpassEvents for Recorder {
        fn request(&self, window: &str, event: &AskpassRequestEvent) {
            self.requests.lock().unwrap().push((window.to_string(), event.clone()));
        }

        fn closed(&self, window: &str, request_id: &str) {
            self.closed.lock().unwrap().push((window.to_string(), request_id.to_string()));
        }
    }

    fn wait_for<T>(what: &str, mut probe: impl FnMut() -> Option<T>) -> T {
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(value) = probe() {
                return value;
            }
            assert!(std::time::Instant::now() < deadline, "hết giờ chờ: {what}");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn server() -> (Arc<AskpassServer>, Arc<Recorder>) {
        let recorder = Arc::new(Recorder::default());
        let server = AskpassServer::start(OsString::from("/x/askpass.sh"), recorder.clone()).unwrap();
        (server, recorder)
    }

    #[test]
    fn a_question_reaches_only_its_window_and_the_answer_goes_back_to_git() {
        let (server, recorder) = server();
        let session = server.session("main", "op-1", "git push");
        let env: HashMap<String, String> = session.env().into_iter().collect();
        assert_eq!(env.get(PORT_ENV), Some(&server.port().to_string()));
        let token = env.get(TOKEN_ENV).unwrap().clone();
        assert_eq!(token.len(), 64);
        assert_eq!(env.contains_key(CLIENT_ENV), cfg!(windows));

        let port = server.port();
        let client = std::thread::spawn(move || ask_server(port, &token, "Password for 'https://thai@github.com': "));
        let (window, event) = wait_for("câu hỏi tới cửa sổ", || recorder.requests.lock().unwrap().first().cloned());
        assert_eq!(window, "main");
        assert_eq!((event.op_id.as_str(), event.operation.as_str(), event.kind), ("op-1", "git push", "password"));
        assert_eq!(event.host.as_deref(), Some("github.com"));
        assert_eq!(event.prompt, "Password for 'https://thai@github.com':");

        // Cửa sổ khác / id lạ không trả lời được; câu trả lời có xuống dòng bị từ chối.
        assert_eq!(server.reply("other", &event.request_id, Some("x".into())).unwrap_err().code(), "not-found");
        assert_eq!(server.reply("main", "khong-co", Some("x".into())).unwrap_err().code(), "not-found");
        assert_eq!(server.reply("main", &event.request_id, Some("a\nb".into())).unwrap_err().code(), "policy");
        server.reply("main", &event.request_id, Some("mật-khẩu bí mật".into())).unwrap();
        assert_eq!(client.join().unwrap().as_deref(), Some("mật-khẩu bí mật"));
        // Đã trả lời rồi thì id hết hiệu lực.
        assert!(server.reply("main", &event.request_id, None).is_err());
        drop(session);
    }

    #[test]
    fn cancel_unknown_tokens_and_control_characters_never_reach_the_ui() {
        let (server, recorder) = server();
        let session = server.session("main", "op-2", "git fetch");
        let token = session.env().into_iter().find(|(k, _)| k == TOKEN_ENV).unwrap().1;
        assert_eq!(ask_server(server.port(), "token-gia", "Password: "), None);
        assert_eq!(ask_server(server.port(), &token, "\u{1b}[31mPassword: "), None);
        assert!(recorder.requests.lock().unwrap().is_empty());

        // Huỷ từ hộp thoại → git nhận "không có câu trả lời".
        let port = server.port();
        let client = std::thread::spawn(move || ask_server(port, &token, "Username for 'https://github.com': "));
        let event = wait_for("câu hỏi", || recorder.requests.lock().unwrap().first().map(|(_, e)| e.clone()));
        server.reply("main", &event.request_id, None).unwrap();
        assert_eq!(client.join().unwrap(), None);
        drop(session);
    }

    #[test]
    fn finishing_the_command_closes_its_open_question() {
        let (server, recorder) = server();
        let session = server.session("main", "op-3", "git pull");
        let token = session.env().into_iter().find(|(k, _)| k == TOKEN_ENV).unwrap().1;
        let port = server.port();
        let client = std::thread::spawn(move || ask_server(port, &token, "Enter passphrase for key '/k': "));
        let event = wait_for("câu hỏi", || recorder.requests.lock().unwrap().first().map(|(_, e)| e.clone()));
        drop(session);
        assert_eq!(client.join().unwrap(), None);
        assert_eq!(recorder.closed.lock().unwrap().as_slice(), &[("main".to_string(), event.request_id.clone())]);
        assert!(server.reply("main", &event.request_id, Some("x".into())).is_err());
    }

    #[test]
    fn client_script_execs_the_app_with_the_flag() {
        let script = client_script(Path::new("/Applications/Thaigit's App.app/Contents/MacOS/thaigit"));
        assert!(script.starts_with("#!/bin/sh\n"));
        assert!(script.trim_end().ends_with(r#"'/Applications/Thaigit'\''s App.app/Contents/MacOS/thaigit' --askpass "$@""#), "{script}");
    }

    #[test]
    fn wrapper_script_quotes_the_executable_path() {
        let script = wrapper_script(Path::new("/Applications/Thaigit's App.app/Contents/MacOS/thaigit"));
        assert!(script.starts_with("#!/bin/sh\n"));
        assert!(script.contains(r"'/Applications/Thaigit'\''s App.app/Contents/MacOS/thaigit' --askpass-deny"));
        assert!(script.trim_end().ends_with("exit 1"));
    }

    #[cfg(unix)]
    mod unix {
        use super::*;
        use std::os::unix::fs::PermissionsExt;
        use std::process::{Command, Stdio};

        fn fake_exe(dir: &Path, marker: &Path) -> std::path::PathBuf {
            let exe = dir.join("thaigit fake");
            std::fs::write(&exe, format!("#!/bin/sh\necho \"$@\" >> '{}'\nexit 1\n", marker.display())).unwrap();
            std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
            exe
        }

        #[test]
        fn wrapper_is_written_executable_and_idempotent() {
            let dir = tempfile::tempdir().unwrap();
            let exe = fake_exe(dir.path(), &dir.path().join("marker"));
            let path = prepare_deny_program(dir.path(), &exe).unwrap();
            let path = std::path::PathBuf::from(path);
            assert_eq!(path, dir.path().join("askpass-deny.sh"));
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o755, 0o755);
            let before = std::fs::metadata(&path).unwrap().modified().unwrap();
            std::thread::sleep(std::time::Duration::from_millis(20));
            prepare_deny_program(dir.path(), &exe).unwrap();
            assert_eq!(std::fs::metadata(&path).unwrap().modified().unwrap(), before, "nội dung không đổi thì không ghi lại");
            // exe đổi chỗ → script được ghi lại
            let moved = dir.path().join("moved");
            std::fs::copy(&exe, &moved).unwrap();
            prepare_deny_program(dir.path(), &moved).unwrap();
            assert!(std::fs::read_to_string(&path).unwrap().contains("moved"));
        }

        #[test]
        fn running_the_wrapper_denies_silently_with_exit_1() {
            let dir = tempfile::tempdir().unwrap();
            let marker = dir.path().join("marker");
            let exe = fake_exe(dir.path(), &marker);
            let wrapper = std::path::PathBuf::from(prepare_deny_program(dir.path(), &exe).unwrap());
            let output = Command::new(&wrapper).arg("Password for 'https://x@github.com': ").stdin(Stdio::null()).output().unwrap();
            assert_eq!(output.status.code(), Some(1));
            assert!(output.stdout.is_empty() && output.stderr.is_empty(), "không in gì");
            assert!(std::fs::read_to_string(&marker).unwrap().contains("--askpass-deny"), "script gọi lại exe với cờ từ chối");
            // exe biến mất → vẫn từ chối (mã ≠ 0), không treo
            std::fs::remove_file(&exe).unwrap();
            let output = Command::new(&wrapper).arg("x").stdin(Stdio::null()).output().unwrap();
            assert_eq!(output.status.code(), Some(1));
        }
    }
}
