//! Lỗi chuẩn hoá: mọi lệnh IPC reject với `{ code, message }` (khớp `CommandError` trong `packages/contracts/src/ipc.ts`).

use serde::{Serialize, Serializer};

pub type Result<T> = std::result::Result<T, AppError>;

/// Mã lỗi gửi sang webview; chuỗi phải khớp `CommandError['code']`.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// Lệnh bị chính sách chặn (cờ/env/URL/subcommand không cho phép).
    #[error("{0}")]
    Policy(String),
    #[error("{0}")]
    NotFound(String),
    /// Đường dẫn thoát khỏi phạm vi repo.
    #[error("{0}")]
    OutOfScope(String),
    /// File đổi bên ngoài (CAS), đích đã tồn tại…
    #[error("{0}")]
    Conflict(String),
    /// Repo đang bận (khoá theo repo).
    #[error("{0}")]
    Busy(String),
    #[error("{0}")]
    Io(String),
    #[error("{0}")]
    GitMissing(String),
    #[error("{0}")]
    GitTooOld(String),
    /// Repo chưa được tin cậy nên không chạy được thao tác này.
    #[error("{0}")]
    Untrusted(String),
    #[error("{0}")]
    Internal(String),
}

impl AppError {
    /// Mã gửi sang TypeScript.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Policy(_) => "policy",
            Self::NotFound(_) => "not-found",
            Self::OutOfScope(_) => "out-of-scope",
            Self::Conflict(_) => "conflict",
            Self::Busy(_) => "busy",
            Self::Io(_) => "io",
            Self::GitMissing(_) => "git-missing",
            Self::GitTooOld(_) => "git-too-old",
            Self::Untrusted(_) => "untrusted",
            Self::Internal(_) => "internal",
        }
    }

    pub fn io(context: &str, error: &std::io::Error) -> Self {
        if error.kind() == std::io::ErrorKind::NotFound {
            Self::NotFound(format!("{context}: không tìm thấy"))
        } else {
            Self::Io(format!("{context}: {error}"))
        }
    }

    pub fn policy(detail: impl Into<String>) -> Self {
        Self::Policy(format!("Lệnh bị chặn bởi chính sách: {}", detail.into()))
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::io("Lỗi vào/ra", &error)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        Self::Internal(format!("Lỗi JSON: {error}"))
    }
}

#[derive(Serialize)]
struct Wire<'a> {
    code: &'static str,
    message: &'a str,
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let message = self.to_string();
        Wire { code: self.code(), message: &message }.serialize(serializer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_command_error_shape() {
        let json = serde_json::to_value(AppError::Conflict("file đã đổi".into())).unwrap();
        assert_eq!(json, serde_json::json!({ "code": "conflict", "message": "file đã đổi" }));
    }

    #[test]
    fn every_code_matches_the_typescript_union() {
        let allowed = [
            "policy", "not-found", "out-of-scope", "conflict", "busy", "io", "git-missing", "git-too-old", "untrusted",
            "internal",
        ];
        let errors = [
            AppError::Policy(String::new()),
            AppError::NotFound(String::new()),
            AppError::OutOfScope(String::new()),
            AppError::Conflict(String::new()),
            AppError::Busy(String::new()),
            AppError::Io(String::new()),
            AppError::GitMissing(String::new()),
            AppError::GitTooOld(String::new()),
            AppError::Untrusted(String::new()),
            AppError::Internal(String::new()),
        ];
        for error in errors {
            assert!(allowed.contains(&error.code()));
        }
    }
}
