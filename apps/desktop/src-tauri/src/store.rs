//! Small JSON files in the app's data directory (recent list, repo trust, git settings): written to a temp file then renamed.

use std::io::Write;
use std::path::Path;

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::errors::{AppError, Result};

/// Read JSON; a missing or corrupt file yields `None` (a broken saved state must never block app startup).
pub fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Atomic JSON write: temp file in the same directory → `fsync` → rename over.
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(value)?;
    write_atomic(path, &bytes)
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let dir = path.parent().ok_or_else(|| AppError::Internal(format!("Đường dẫn không có thư mục cha: {}", path.display())))?;
    std::fs::create_dir_all(dir).map_err(|e| AppError::io("Tạo thư mục dữ liệu", &e))?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let temp = dir.join(format!(".{name}.{}.tmp", uuid::Uuid::new_v4().simple()));
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(&temp, path)
    })();
    if let Err(error) = result {
        let _ = std::fs::remove_file(&temp);
        return Err(AppError::io("Ghi file dữ liệu", &error));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Serialize, Deserialize, PartialEq, Debug)]
    struct Sample {
        name: String,
        n: u32,
    }

    #[test]
    fn round_trips_and_replaces_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/x.json");
        write_json(&path, &Sample { name: "a".into(), n: 1 }).unwrap();
        write_json(&path, &Sample { name: "b".into(), n: 2 }).unwrap();
        assert_eq!(read_json::<Sample>(&path), Some(Sample { name: "b".into(), n: 2 }));
        let leftovers: Vec<_> =
            std::fs::read_dir(path.parent().unwrap()).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name()).collect();
        assert_eq!(leftovers.len(), 1, "không để lại file tạm: {leftovers:?}");
    }

    #[test]
    fn missing_or_corrupt_file_reads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_json::<Sample>(&dir.path().join("none.json")), None);
        let bad = dir.path().join("bad.json");
        std::fs::write(&bad, b"{not json").unwrap();
        assert_eq!(read_json::<Sample>(&bad), None);
    }
}
