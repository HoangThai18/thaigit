//! Terminal thật trong cửa sổ repo (như terminal tích hợp của GitKraken): shell của máy (PowerShell trên Windows, shell đăng
//! nhập trên macOS / Linux) chạy qua PTY ở thư mục gốc repo; webview vẽ bằng xterm.js.
//!
//! Ranh giới tin cậy: webview chỉ chọn REPO (theo id trong registry), kích thước và gửi phím gõ — chương trình, tham số,
//! thư mục làm việc và env đều do Rust quyết định. Đây là tính năng chủ ý cho người dùng gõ lệnh tuỳ ý, nên phím gõ được
//! chuyển nguyên văn cho shell; mọi chuỗi lấy từ repo trong webview vẫn chỉ render dạng text (không có HTML thô) để nội dung
//! repo không thể tự gõ vào terminal.

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Mutex;

use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;

use crate::errors::{AppError, Result};

/// Số terminal tối đa mở cùng lúc (mọi cửa sổ) — chặn webview mở vô hạn tiến trình.
const MAX_SESSIONS: usize = 16;

/// Sự kiện gửi lên webview qua Channel.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TerminalEvent {
    /// Output của shell (base64 — byte thô, có thể cắt giữa ký tự UTF-8; xterm.js tự ghép).
    Data { data: String },
    /// Shell đã thoát.
    Exit,
}

struct Session {
    window: String,
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct Terminals {
    sessions: Mutex<HashMap<String, Session>>,
}

fn clamp_size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.clamp(2, 500), cols: cols.clamp(2, 1000), pixel_width: 0, pixel_height: 0 }
}

/// Shell mặc định: Windows ưu tiên PowerShell 7 (`pwsh`), không có thì Windows PowerShell; nơi khác dùng `$SHELL` (đăng nhập).
fn shell_command(path_env: &OsString) -> CommandBuilder {
    #[cfg(windows)]
    {
        let pwsh = std::env::split_paths(path_env).map(|dir| dir.join("pwsh.exe")).find(|candidate| candidate.is_file());
        let mut command = CommandBuilder::new(pwsh.map(OsString::from).unwrap_or_else(|| OsString::from("powershell.exe")));
        command.arg("-NoLogo");
        command
    }
    #[cfg(not(windows))]
    {
        let _ = path_env;
        let shell = std::env::var("SHELL").ok().filter(|value| Path::new(value).is_file()).unwrap_or_else(|| "/bin/zsh".into());
        let mut command = CommandBuilder::new(shell);
        command.arg("-l");
        command
    }
}

impl Terminals {
    /// Mở terminal ở `root`. `on_event` nhận output / sự kiện thoát (gọi từ luồng đọc riêng).
    pub fn open(
        &self,
        window: &str,
        root: &Path,
        cols: u16,
        rows: u16,
        path_env: OsString,
        on_event: impl Fn(TerminalEvent) + Send + 'static,
    ) -> Result<String> {
        if self.lock().len() >= MAX_SESSIONS {
            return Err(AppError::Busy("Đã mở quá nhiều terminal — hãy đóng bớt".into()));
        }
        let unavailable = |_| AppError::Io("Không mở được terminal trên máy này".into());
        let pair = native_pty_system().openpty(clamp_size(cols, rows)).map_err(unavailable)?;
        let mut command = shell_command(&path_env);
        command.cwd(root);
        command.env("PATH", &path_env);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        command.env("TERM_PROGRAM", "Thaigit");
        let child = pair.slave.spawn_command(command).map_err(unavailable)?;
        drop(pair.slave);
        let killer = child.clone_killer();
        let mut reader = pair.master.try_clone_reader().map_err(unavailable)?;
        let writer = pair.master.take_writer().map_err(unavailable)?;
        let id = uuid::Uuid::new_v4().to_string();
        self.lock().insert(id.clone(), Session { window: window.to_string(), writer, master: pair.master, killer });

        std::thread::spawn(move || {
            use base64::Engine;
            let mut child = child;
            let mut buffer = [0u8; 16 * 1024];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => on_event(TerminalEvent::Data {
                        data: base64::engine::general_purpose::STANDARD.encode(&buffer[..count]),
                    }),
                }
            }
            let _ = child.wait();
            on_event(TerminalEvent::Exit);
        });
        Ok(id)
    }

    /// Phím gõ của người dùng (đúng terminal của cửa sổ đó).
    pub fn write(&self, window: &str, id: &str, data: &str) -> Result<()> {
        let mut sessions = self.lock();
        let session = sessions.get_mut(id).filter(|s| s.window == window).ok_or_else(Self::missing)?;
        session.writer.write_all(data.as_bytes()).and_then(|()| session.writer.flush()).map_err(|_| Self::missing())
    }

    pub fn resize(&self, window: &str, id: &str, cols: u16, rows: u16) -> Result<()> {
        let sessions = self.lock();
        let session = sessions.get(id).filter(|s| s.window == window).ok_or_else(Self::missing)?;
        session.master.resize(clamp_size(cols, rows)).map_err(|_| Self::missing())
    }

    /// Đóng một terminal (dừng shell).
    pub fn close(&self, window: &str, id: &str) {
        let removed = {
            let mut sessions = self.lock();
            match sessions.get(id) {
                Some(session) if session.window == window => sessions.remove(id),
                _ => None,
            }
        };
        if let Some(mut session) = removed {
            let _ = session.killer.kill();
        }
    }

    /// Cửa sổ đóng / webview tải lại: dừng mọi terminal của cửa sổ đó.
    pub fn close_window(&self, window: &str) {
        let removed: Vec<Session> = {
            let mut sessions = self.lock();
            let ids: Vec<String> = sessions.iter().filter(|(_, s)| s.window == window).map(|(id, _)| id.clone()).collect();
            ids.iter().filter_map(|id| sessions.remove(id)).collect()
        };
        for mut session in removed {
            let _ = session.killer.kill();
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Session>> {
        self.sessions.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn missing() -> AppError {
        AppError::NotFound("Terminal này đã đóng".into())
    }
}

impl Drop for Terminals {
    fn drop(&mut self) {
        for (_, mut session) in self.lock().drain() {
            let _ = session.killer.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn runs_a_shell_in_the_repo_and_isolates_windows() {
        let dir = tempfile::tempdir().unwrap();
        let terminals = Terminals::default();
        let (tx, rx) = mpsc::channel::<TerminalEvent>();
        let path = std::env::var_os("PATH").unwrap_or_default();
        let id = terminals.open("main", dir.path(), 80, 24, path, move |event| { let _ = tx.send(event); }).unwrap();
        // Cửa sổ khác không gõ / đóng được terminal này.
        assert!(terminals.write("other", &id, "echo x\r").is_err());
        terminals.close("other", &id);
        // Ghép chuỗi trong shell để output khác dòng lệnh vừa gõ (terminal tự in lại phím gõ).
        let line = if cfg!(windows) { "echo ('thai' + 'git-42')\r" } else { "echo thai''git-42\r" };
        terminals.write("main", &id, line).unwrap();
        terminals.resize("main", &id, 100, 30).unwrap();
        let mut output = String::new();
        let deadline = std::time::Instant::now() + Duration::from_secs(20);
        while std::time::Instant::now() < deadline && !output.contains("\nthaigit-42") {
            if let Ok(TerminalEvent::Data { data }) = rx.recv_timeout(Duration::from_millis(200)) {
                use base64::Engine;
                output.push_str(&String::from_utf8_lossy(&base64::engine::general_purpose::STANDARD.decode(data).unwrap()));
            }
        }
        assert!(output.contains("\nthaigit-42"), "{output}");
        terminals.close_window("main");
        assert!(terminals.write("main", &id, "x").is_err());
        let exited = (0..100).any(|_| matches!(rx.recv_timeout(Duration::from_millis(200)), Ok(TerminalEvent::Exit)));
        assert!(exited);
    }
}
