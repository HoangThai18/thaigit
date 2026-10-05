//! Runs the child process and streams frames: stdout/stderr are read concurrently (so neither deadlocks when both grow
//! large), and cancellation happens in stages.
//!
//! Unix: each command is its own process group (`process_group(0)`), cancelling = SIGTERM the group → wait → SIGKILL.
//! Windows: `CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP` plus a Job Object; cancelling = CTRL_BREAK → wait →
//! `TerminateJobObject`.
//! This module knows nothing about repos or policy; `core.rs` handles validation, locking and window labels.

use std::ffi::OsString;
use std::path::PathBuf;
use std::process::{ExitStatus, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::sync::Notify;
use tokio::task::JoinHandle;

use crate::errors::{AppError, Result};
use crate::frames::{LineSplitter, MAX_STDOUT_FRAME, TAG_STDOUT, stderr_frame};

/// Where frames are received (Tauri's Channel in the app; a collector in tests).
pub trait FrameSink: Send + Sync + 'static {
    fn send(&self, frame: Vec<u8>);
}

/// Cap on the total bytes (stdout + stderr) one command may forward. The webview does not acknowledge frames, so there is
/// no real backpressure: a large frame sits in Tauri's IPC queue until JS picks it up, and a hung or busy webview never
/// does. This is the UPPER BOUND on that memory (and on an internal command's collector): past it, frames are dropped,
/// the process is cancelled and `exceeded` is set, so the caller reports a clear error instead of an `exit` frame.
pub struct LimitedSink {
    inner: Arc<dyn FrameSink>,
    limit: u64,
    sent: AtomicU64,
    exceeded: AtomicBool,
    cancel: Arc<CancelToken>,
}

impl LimitedSink {
    pub fn new(inner: Arc<dyn FrameSink>, limit: u64, cancel: Arc<CancelToken>) -> Self {
        Self { inner, limit, sent: AtomicU64::new(0), exceeded: AtomicBool::new(false), cancel }
    }

    /// Already past the limit (the process was cancelled, the remaining output dropped)?
    pub fn exceeded(&self) -> bool {
        self.exceeded.load(Ordering::SeqCst)
    }

    pub fn limit(&self) -> u64 {
        self.limit
    }
}

impl FrameSink for LimitedSink {
    fn send(&self, frame: Vec<u8>) {
        if self.exceeded() {
            return;
        }
        let total = self.sent.fetch_add(frame.len() as u64, Ordering::SeqCst).saturating_add(frame.len() as u64);
        if total > self.limit {
            self.exceeded.store(true, Ordering::SeqCst);
            self.cancel.cancel();
            return;
        }
        self.inner.send(frame);
    }
}

/// Cancellation signal shared by the op table, the locks and the command-running task.
#[derive(Debug, Default)]
pub struct CancelToken {
    flag: AtomicBool,
    notify: Notify,
}

impl CancelToken {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
        self.notify.notify_one();
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }

    pub async fn cancelled(&self) {
        loop {
            let notified = self.notify.notified();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

/// Wait time for each cancellation stage.
#[derive(Debug, Clone, Copy)]
pub struct CancelTiming {
    /// After a soft signal (SIGTERM / CTRL_BREAK), wait this long before the hard kill.
    pub soft_wait: Duration,
    /// After the main process exits due to cancellation, give the child process group this long to clean up before the
    /// hard kill.
    pub group_grace: Duration,
    /// After the process exits, wait this long for both reader threads to drain (skipped when a grandchild keeps the pipe
    /// open).
    pub reader_grace: Duration,
}

impl Default for CancelTiming {
    fn default() -> Self {
        Self { soft_wait: Duration::from_secs(4), group_grace: Duration::from_millis(500), reader_grace: Duration::from_secs(2) }
    }
}

#[derive(Debug, Clone)]
pub struct ProcessSpec {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub cwd: PathBuf,
    /// The full environment (`env_clear`, then these variables set).
    pub env: Vec<(OsString, OsString)>,
    pub stdin: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExitInfo {
    pub code: i32,
    pub cancelled: bool,
}

#[cfg(windows)]
mod job {
    //! Job Object: groups git and every child process so `TerminateJobObject` cleans up at the hard stage.
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{AssignProcessToJobObject, CreateJobObjectW, TerminateJobObject};

    pub struct Job(HANDLE);

    // SAFETY: the Job Object HANDLE is usable from any thread; we only call thread-safe Win32 APIs.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub fn create_and_assign(process: HANDLE) -> Option<Self> {
            // SAFETY: null parameters are valid (anonymous job, default attributes); the result is checked.
            let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if handle.is_null() {
                return None;
            }
            let job = Self(handle);
            // SAFETY: both handles are alive during the call.
            let assigned = unsafe { AssignProcessToJobObject(job.0, process) };
            (assigned != 0).then_some(job)
        }

        pub fn terminate(&self) {
            // SAFETY: the job handle stays alive until `Drop`.
            unsafe { TerminateJobObject(self.0, 1) };
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: closing the handle we created exactly once. KILL_ON_JOB_CLOSE is not set, so background git
            // processes (a detached `gc --auto`) are not killed when the command ends.
            unsafe { CloseHandle(self.0) };
        }
    }
}

#[cfg(unix)]
fn signal_group(pid: u32, signal: Option<nix::sys::signal::Signal>) -> bool {
    use nix::sys::signal::killpg;
    use nix::unistd::Pid;
    i32::try_from(pid).is_ok_and(|raw| killpg(Pid::from_raw(raw), signal).is_ok())
}

/// Soft stage: SIGTERM the whole process group (git cleans up its own `*.lock`) / CTRL_BREAK to the process group (Windows).
/// Returns `true` when the signal was actually sent.
fn soft_signal(pid: u32) -> bool {
    #[cfg(unix)]
    {
        signal_group(pid, Some(nix::sys::signal::Signal::SIGTERM))
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Console::{CTRL_BREAK_EVENT, GenerateConsoleCtrlEvent};
        // Best effort: a GUI app has no console attached and the child (CREATE_NO_WINDOW) has its own, so this usually
        // fails (returns 0) — waiting out the soft stage would be pointless, so go straight to the hard stage (see the
        // plan: spike CTRL_BREAK).
        // SAFETY: Win32 API called with an integer, no pointers.
        unsafe { GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, pid) != 0 }
    }
}

struct Handles {
    pid: Option<u32>,
    #[cfg(windows)]
    job: Option<job::Job>,
}

impl Handles {
    /// Hard stage: SIGKILL the whole group / `TerminateJobObject`.
    fn hard_kill(&self, child: &mut Child) {
        #[cfg(unix)]
        if let Some(pid) = self.pid {
            signal_group(pid, Some(nix::sys::signal::Signal::SIGKILL));
        }
        #[cfg(windows)]
        if let Some(job) = &self.job {
            job.terminate();
        }
        let _ = child.start_kill();
    }

    /// Is any process left in the group (Unix: `killpg(pgid, 0)`)?
    fn group_alive(&self) -> bool {
        #[cfg(unix)]
        {
            self.pid.is_some_and(|pid| signal_group(pid, None))
        }
        #[cfg(not(unix))]
        {
            false
        }
    }
}

async fn staged_kill(child: &mut Child, handles: &Handles, timing: CancelTiming) -> std::io::Result<ExitStatus> {
    let soft_delivered = handles.pid.is_some_and(soft_signal);
    if cfg!(windows) && !soft_delivered {
        handles.hard_kill(child);
        return child.wait().await;
    }
    match tokio::time::timeout(timing.soft_wait, child.wait()).await {
        Ok(status) => {
            // The main process exited from the soft signal: give the child group time to clean up, then hard-kill the rest.
            let deadline = tokio::time::Instant::now() + timing.group_grace;
            while handles.group_alive() && tokio::time::Instant::now() < deadline {
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            if handles.group_alive() {
                handles.hard_kill(child);
            }
            #[cfg(windows)]
            if let Some(job) = &handles.job {
                job.terminate();
            }
            status
        }
        Err(_) => {
            handles.hard_kill(child);
            child.wait().await
        }
    }
}

/// Coalesces small reads into larger frames (≤ 64 KB) to cut IPC message count: `git log` writes in small chunks, so one
/// frame per read would turn 6 MB into tens of thousands of messages. Waits at most `COALESCE` for the pending tail.
const COALESCE: Duration = Duration::from_millis(3);

fn fresh_frame() -> Vec<u8> {
    let mut frame = Vec::with_capacity(1 + MAX_STDOUT_FRAME);
    frame.push(TAG_STDOUT);
    frame
}

async fn pump_stdout<R: AsyncRead + Unpin>(mut out: R, sink: Arc<dyn FrameSink>) {
    let mut scratch = vec![0u8; MAX_STDOUT_FRAME];
    let mut frame = fresh_frame();
    loop {
        let read = if frame.len() == 1 {
            out.read(&mut scratch).await
        } else {
            match tokio::time::timeout(COALESCE, out.read(&mut scratch)).await {
                Ok(result) => result,
                Err(_) => {
                    // Silent for more than `COALESCE`: flush what is buffered so the receiver need not wait.
                    sink.send(std::mem::replace(&mut frame, fresh_frame()));
                    continue;
                }
            }
        };
        match read {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let mut data = &scratch[..n];
                while !data.is_empty() {
                    let room = 1 + MAX_STDOUT_FRAME - frame.len();
                    let take = room.min(data.len());
                    frame.extend_from_slice(&data[..take]);
                    data = &data[take..];
                    if frame.len() == 1 + MAX_STDOUT_FRAME {
                        sink.send(std::mem::replace(&mut frame, fresh_frame()));
                    }
                }
            }
        }
    }
    if frame.len() > 1 {
        sink.send(frame);
    }
}

async fn pump_stderr<R: AsyncRead + Unpin>(mut err: R, sink: Arc<dyn FrameSink>) {
    let mut scratch = vec![0u8; 8192];
    let mut splitter = LineSplitter::default();
    loop {
        match err.read(&mut scratch).await {
            Ok(0) | Err(_) => break,
            Ok(n) => splitter.push(&scratch[..n], &mut |line| sink.send(stderr_frame(&line))),
        }
    }
    splitter.finish(&mut |line| sink.send(stderr_frame(&line)));
}

async fn drain(task: Option<JoinHandle<()>>, grace: Duration) {
    let Some(mut task) = task else { return };
    if tokio::time::timeout(grace, &mut task).await.is_err() {
        // A grandchild keeps the pipe open after git exits: skip it so the exit frame can still be sent.
        task.abort();
    }
}

#[cfg(unix)]
fn exit_code(status: ExitStatus) -> i32 {
    use std::os::unix::process::ExitStatusExt;
    status.code().unwrap_or_else(|| 128 + status.signal().unwrap_or(0))
}

#[cfg(not(unix))]
fn exit_code(status: ExitStatus) -> i32 {
    status.code().unwrap_or(-1)
}

fn spawn_error(program: &std::path::Path, error: &std::io::Error) -> AppError {
    if error.kind() == std::io::ErrorKind::NotFound {
        AppError::GitMissing(format!("Không tìm thấy chương trình {}", program.display()))
    } else {
        AppError::Io(format!("Không chạy được {}: {error}", program.display()))
    }
}

/// Runs the process, sends stdout/stderr frames to `sink` and returns the exit code. It does NOT send the exit frame —
/// the caller does that once every other frame has finished (it is always last). `cancel` = `None` means the command cannot
/// be cancelled.
pub async fn run_process(
    spec: ProcessSpec,
    sink: Arc<dyn FrameSink>,
    cancel: Option<Arc<CancelToken>>,
    timing: CancelTiming,
) -> Result<ExitInfo> {
    let mut command = Command::new(&spec.program);
    command
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .env_clear()
        .envs(spec.env.iter().map(|(k, v)| (k, v)))
        .stdin(if spec.stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Do not kill when dropping the future: hard-killing a git that is writing is how orphaned `index.lock` files happen.
        .kill_on_drop(false);
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    {
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }

    let mut child = command.spawn().map_err(|e| spawn_error(&spec.program, &e))?;
    let handles = Handles {
        pid: child.id(),
        #[cfg(windows)]
        job: child.raw_handle().and_then(|raw| job::Job::create_and_assign(raw.cast())),
    };

    if let (Some(data), Some(mut stdin)) = (spec.stdin, child.stdin.take()) {
        tokio::spawn(async move {
            // Git may exit before reading all of stdin (BrokenPipe): not an error.
            let _ = stdin.write_all(&data).await;
            let _ = stdin.shutdown().await;
        });
    }
    let stdout_task = child.stdout.take().map(|out| tokio::spawn(pump_stdout(out, sink.clone())));
    let stderr_task = child.stderr.take().map(|err| tokio::spawn(pump_stderr(err, sink.clone())));

    let mut cancelled = false;
    let status = match &cancel {
        Some(token) => {
            tokio::select! {
                status = child.wait() => status,
                () = token.cancelled() => {
                    cancelled = true;
                    staged_kill(&mut child, &handles, timing).await
                }
            }
        }
        None => child.wait().await,
    }
    .map_err(|e| AppError::Io(format!("Lỗi khi chờ tiến trình: {e}")))?;

    drain(stdout_task, timing.reader_grace).await;
    drain(stderr_task, timing.reader_grace).await;
    Ok(ExitInfo { code: exit_code(status), cancelled })
}

/// Frame collector (for tests and internal commands that need the full output).
#[derive(Debug, Default)]
pub struct CollectSink {
    frames: std::sync::Mutex<Vec<Vec<u8>>>,
}

impl FrameSink for CollectSink {
    fn send(&self, frame: Vec<u8>) {
        self.frames.lock().unwrap_or_else(|p| p.into_inner()).push(frame);
    }
}

/// The collected output.
#[derive(Debug, Default, Clone)]
pub struct Collected {
    pub stdout: Vec<u8>,
    pub stderr_lines: Vec<Vec<u8>>,
    pub exit: Option<ExitInfo>,
    pub frame_count: usize,
}

impl Collected {
    pub fn stdout_text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }

    pub fn stderr_text(&self) -> String {
        self.stderr_lines.iter().map(|l| String::from_utf8_lossy(l).into_owned()).collect::<Vec<_>>().join("\n")
    }
}

impl CollectSink {
    /// Concatenate the received frames (in send order) into one output.
    pub fn collect(&self) -> Collected {
        let frames = self.frames.lock().unwrap_or_else(|p| p.into_inner());
        let mut out = Collected { frame_count: frames.len(), ..Collected::default() };
        for frame in frames.iter() {
            match frame.first() {
                Some(&crate::frames::TAG_STDOUT) => out.stdout.extend_from_slice(&frame[1..]),
                Some(&crate::frames::TAG_STDERR_LINE) => out.stderr_lines.push(frame[1..].to_vec()),
                Some(&crate::frames::TAG_EXIT) => {
                    out.exit = crate::frames::decode_exit_frame(frame).map(|(code, cancelled)| ExitInfo { code, cancelled });
                }
                _ => {}
            }
        }
        out
    }

    pub fn frames(&self) -> Vec<Vec<u8>> {
        self.frames.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    fn sh(script: &str) -> ProcessSpec {
        ProcessSpec {
            program: PathBuf::from("/bin/sh"),
            args: vec!["-c".into(), script.into()],
            cwd: std::env::temp_dir(),
            env: vec![("PATH".into(), "/usr/bin:/bin".into())],
            stdin: None,
        }
    }

    async fn run(spec: ProcessSpec) -> (ExitInfo, Collected) {
        let sink = Arc::new(CollectSink::default());
        let exit = run_process(spec, sink.clone(), None, CancelTiming::default()).await.unwrap();
        (exit, sink.collect())
    }

    fn fast() -> CancelTiming {
        CancelTiming { soft_wait: Duration::from_millis(400), group_grace: Duration::from_millis(200), reader_grace: Duration::from_millis(500) }
    }

    #[tokio::test]
    async fn streams_stdout_and_stderr_lines() {
        let (exit, out) = run(sh("printf 'hello'; printf 'Receiving: 10%%\\rReceiving: 100%%\\nwarn\\n' >&2; exit 3")).await;
        assert_eq!(exit, ExitInfo { code: 3, cancelled: false });
        assert_eq!(out.stdout_text(), "hello");
        let lines: Vec<String> = out.stderr_lines.iter().map(|l| String::from_utf8_lossy(l).into_owned()).collect();
        assert_eq!(lines, ["Receiving: 10%", "Receiving: 100%", "warn"]);
    }

    #[tokio::test]
    async fn heavy_stdout_and_stderr_at_once_do_not_deadlock() {
        // 6 MB per stream, far beyond the pipe buffer: reading sequentially would deadlock.
        let script = "head -c 6000000 /dev/zero | tr '\\0' 'a' & head -c 6000000 /dev/zero | tr '\\0' 'b' >&2 & wait";
        let (exit, out) = tokio::time::timeout(Duration::from_secs(30), run(sh(script))).await.expect("không được treo");
        assert_eq!(exit.code, 0);
        assert_eq!(out.stdout.len(), 6_000_000);
        assert!(out.stdout.iter().all(|b| *b == b'a'));
        let stderr_bytes: usize = out.stderr_lines.iter().map(Vec::len).sum();
        assert_eq!(stderr_bytes, 6_000_000);
    }

    #[tokio::test]
    async fn large_stdout_is_chunked_within_the_frame_limit_and_hash_matches() {
        let sink = Arc::new(CollectSink::default());
        // A simulated 50 MB `git log`; compare the receiver's SHA-256 with the sender's.
        let script = "head -c 52428800 /dev/urandom | tee /dev/stderr 2>/dev/null | cat";
        let mut spec = sh(script);
        spec.args = vec!["-c".into(), "head -c 52428800 /dev/urandom > \"$OUT\"; cat \"$OUT\"".into()];
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("blob.bin");
        spec.env.push(("OUT".into(), file.clone().into()));
        let exit = run_process(spec, sink.clone(), None, CancelTiming::default()).await.unwrap();
        assert_eq!(exit.code, 0);
        let frames = sink.frames();
        assert!(frames.iter().all(|f| f.len() <= 1 + MAX_STDOUT_FRAME), "mỗi frame ≤ 64 KB + tag");
        let collected = sink.collect();
        let expected = Sha256::digest(std::fs::read(&file).unwrap());
        assert_eq!(collected.stdout.len(), 52_428_800);
        assert_eq!(Sha256::digest(&collected.stdout), expected);
    }

    #[tokio::test]
    async fn stdin_reaches_the_child_and_closes() {
        let mut spec = sh("cat");
        spec.stdin = Some(b"patch\0data\n".to_vec());
        let (exit, out) = run(spec).await;
        assert_eq!(exit.code, 0);
        assert_eq!(out.stdout, b"patch\0data\n");
    }

    #[tokio::test]
    async fn child_that_ignores_stdin_does_not_break_the_run() {
        let mut spec = sh("exit 0");
        spec.stdin = Some(vec![b'x'; 5_000_000]);
        let (exit, _) = run(spec).await;
        assert_eq!(exit.code, 0);
    }

    #[tokio::test]
    async fn signal_exit_maps_to_128_plus_signal() {
        let (exit, _) = run(sh("kill -9 $$")).await;
        assert_eq!(exit.code, 128 + 9);
    }

    #[tokio::test]
    async fn missing_program_is_reported_as_git_missing() {
        let mut spec = sh("true");
        spec.program = PathBuf::from("/nonexistent/git");
        let error = run_process(spec, Arc::new(CollectSink::default()), None, CancelTiming::default()).await.unwrap_err();
        assert_eq!(error.code(), "git-missing");
    }

    #[tokio::test]
    async fn soft_cancel_stops_a_cooperative_process_quickly() {
        let token = CancelToken::new();
        let spec = sh("sleep 30");
        let sink = Arc::new(CollectSink::default());
        let canceller = token.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(150)).await;
            canceller.cancel();
        });
        let started = std::time::Instant::now();
        let exit = run_process(spec, sink, Some(token), fast()).await.unwrap();
        assert!(exit.cancelled);
        assert_eq!(exit.code, 128 + 15, "SIGTERM");
        assert!(started.elapsed() < Duration::from_secs(2), "{:?}", started.elapsed());
    }

    #[tokio::test]
    async fn hard_cancel_escalates_to_sigkill_when_sigterm_is_ignored() {
        let token = CancelToken::new();
        let spec = sh("trap '' TERM; while true; do sleep 1; done");
        let canceller = token.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(200)).await;
            canceller.cancel();
        });
        let started = std::time::Instant::now();
        let exit = run_process(spec, Arc::new(CollectSink::default()), Some(token), fast()).await.unwrap();
        assert!(exit.cancelled);
        assert_eq!(exit.code, 128 + 9, "SIGKILL sau bậc mềm");
        assert!(started.elapsed() >= Duration::from_millis(400), "phải chờ hết bậc mềm");
        assert!(started.elapsed() < Duration::from_secs(4));
    }

    #[tokio::test]
    async fn cancel_kills_grandchildren_in_the_process_group() {
        let dir = tempfile::tempdir().unwrap();
        let pid_file = dir.path().join("grandchild.pid");
        let script = format!("sleep 30 & echo $! > '{}'; wait", pid_file.display());
        let token = CancelToken::new();
        let canceller = token.clone();
        let watch = pid_file.clone();
        tokio::spawn(async move {
            for _ in 0..100 {
                if std::fs::read_to_string(&watch).is_ok_and(|s| !s.trim().is_empty()) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            canceller.cancel();
        });
        let exit = run_process(sh(&script), Arc::new(CollectSink::default()), Some(token), fast()).await.unwrap();
        assert!(exit.cancelled);
        let pid: i32 = std::fs::read_to_string(&pid_file).unwrap().trim().parse().unwrap();
        // Wait for the OS to finish cleaning up, then check that the grandchild is dead (kill(pid, 0) → ESRCH).
        let mut dead = false;
        for _ in 0..50 {
            if nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), None).is_err() {
                dead = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(dead, "tiến trình cháu {pid} phải bị dọn cùng nhóm");
    }

    #[tokio::test]
    async fn grandchild_holding_the_pipe_open_does_not_block_the_exit() {
        // A background grandchild keeps stdout/stderr open after the main process exits.
        let spec = sh("(sleep 20 >&1 2>&2 &) ; echo done");
        let timing = CancelTiming { reader_grace: Duration::from_millis(300), ..CancelTiming::default() };
        let started = std::time::Instant::now();
        let exit = run_process(spec, Arc::new(CollectSink::default()), None, timing).await.unwrap();
        assert_eq!(exit.code, 0);
        assert!(started.elapsed() < Duration::from_secs(5), "{:?}", started.elapsed());
    }

    #[tokio::test]
    async fn cancel_token_before_start_cancels_immediately() {
        let token = CancelToken::new();
        token.cancel();
        token.cancelled().await;
        assert!(token.is_cancelled());
    }
}
