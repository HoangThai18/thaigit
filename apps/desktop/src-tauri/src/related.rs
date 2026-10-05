//! Worktrees and submodules (like GitKraken): add a worktree (a typed command — the destination folder is picked with a
//! native dialog, like clone) and open one of the opened repo's worktrees / submodules in a new window.
//!
//! Rust does not accept an arbitrary path from the webview to open: the path must be a worktree reported by the repo's OWN
//! `git worktree list`, or an initialised submodule (a `160000` gitlink in the index, inside the working tree). The new
//! window picks that path up via `take_launch_paths` keyed by window label (see `Registry::set_window_launch`), then goes
//! through the normal repo-opening flow (asking for trust when needed).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;

use crate::core::{Core, SpawnOptions};
use crate::errors::{AppError, Result};
use crate::pathutil::canonical;
use crate::policy::EnvProfile;
use crate::typed::validate_dir_name;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RelatedKind {
    Worktree,
    Submodule,
}

/// Branch / commit-ish handed to `git worktree add`: non-empty, not starting with `-` (which would read as an option), no
/// control characters or whitespace. Git validates the branch name as a last step.
pub fn validate_branch_arg(value: &str) -> Result<()> {
    let bad = value.is_empty()
        || value.len() > 255
        || value.starts_with('-')
        || value.chars().any(|c| c.is_control() || c.is_whitespace());
    if bad { Err(AppError::policy(format!("tên nhánh `{value}` không hợp lệ"))) } else { Ok(()) }
}

/// The worktree paths in `git worktree list --porcelain -z` output (each field ends with NUL).
pub fn parse_worktree_paths(output: &str) -> Vec<PathBuf> {
    output.split('\0').filter_map(|field| field.strip_prefix("worktree ")).map(PathBuf::from).collect()
}

impl Core {
    async fn run_in_repo(&self, repo_id: &str, sub: &str, args: &[String]) -> Result<crate::core::GitOutput> {
        let entry = self.registry.get(repo_id)?;
        self.run_git(
            SpawnOptions {
                cwd: &entry.root,
                sub,
                args,
                stdin: None,
                profile: EnvProfile::Background,
                caller_env: BTreeMap::from([("GIT_LITERAL_PATHSPECS".to_string(), "1".to_string())]),
                restrictions: entry.restrictions.as_ref(),
            },
            Some(Duration::from_secs(120)),
        )
        .await
    }

    /// The normalised path of one worktree / submodule of repo `repo_id` — rejected when git does not confirm it.
    pub async fn related_repo_path(&self, repo_id: &str, kind: RelatedKind, path: &str) -> Result<PathBuf> {
        let entry = self.registry.get(repo_id)?;
        match kind {
            RelatedKind::Worktree => {
                let wanted = canonical(Path::new(path)).map_err(|_| AppError::NotFound("Không thấy thư mục worktree".into()))?;
                let output = self.run_in_repo(repo_id, "worktree", &["list".into(), "--porcelain".into(), "-z".into()]).await?;
                if !output.ok() {
                    return Err(AppError::Io(format!("git worktree list thất bại: {}", output.stderr().trim())));
                }
                let listed = parse_worktree_paths(&output.stdout()).iter().any(|item| canonical(item).is_ok_and(|item| item == wanted));
                if !listed {
                    return Err(AppError::policy("đường dẫn không phải worktree của repo này"));
                }
                Ok(wanted)
            }
            RelatedKind::Submodule => {
                let relative = path.trim_matches('/');
                if relative.is_empty() || relative.split('/').any(|part| part.is_empty() || part == "." || part == "..") || relative.contains('\0') {
                    return Err(AppError::policy("đường dẫn submodule không hợp lệ"));
                }
                let output = self.run_in_repo(repo_id, "ls-files", &["-s".into(), "-z".into(), "--".into(), relative.to_string()]).await?;
                let stdout = output.stdout();
                let is_gitlink = stdout.split('\0').any(|line| {
                    line.split_once('\t').is_some_and(|(meta, name)| meta.starts_with("160000 ") && name == relative)
                });
                if !output.ok() || !is_gitlink {
                    return Err(AppError::policy("đường dẫn không phải submodule của repo này"));
                }
                let dir = canonical(&entry.root.join(relative)).map_err(|_| AppError::NotFound("Submodule chưa được khởi tạo".into()))?;
                if !dir.starts_with(&entry.root) || !dir.join(".git").exists() {
                    return Err(AppError::NotFound("Submodule chưa được khởi tạo".into()));
                }
                Ok(dir)
            }
        }
    }

    /// `git_worktree_add`: add a worktree in `<token>/<name>` (the token comes from a native dialog). `create_branch` =
    /// create a new branch `branch` from `start` (null = HEAD); otherwise check out the existing `branch`. Returns the new worktree path.
    pub async fn git_worktree_add(
        &self,
        repo_id: &str,
        token: &str,
        name: &str,
        branch: &str,
        create_branch: bool,
        start: Option<&str>,
    ) -> Result<String> {
        validate_dir_name(name)?;
        validate_branch_arg(branch)?;
        if let Some(start) = start {
            validate_branch_arg(start)?;
        }
        let entry = self.registry.get(repo_id)?;
        if entry.restrictions.as_ref().is_some_and(|r| r.fail_closed) {
            return Err(AppError::Untrusted("Repo chưa được tin cậy nên không thêm worktree được. Hãy tin tưởng repo để tiếp tục.".into()));
        }
        let base = self.registry.peek_grant(token)?;
        let dest = base.join(name);
        if dest.exists() {
            return Err(AppError::Conflict(format!("Thư mục đích `{}` đã tồn tại", dest.display())));
        }
        let dest_text = dest.to_str().ok_or_else(|| AppError::Io("đường dẫn đích không phải UTF-8".into()))?.to_string();
        let mut args = vec!["add".to_string()];
        if create_branch {
            args.push("-b".into());
            args.push(branch.to_string());
            args.push(dest_text.clone());
            if let Some(start) = start {
                args.push(start.to_string());
            }
        } else {
            args.push(dest_text.clone());
            args.push(branch.to_string());
        }
        let output = self.run_in_repo(repo_id, "worktree", &args).await?;
        if !output.ok() {
            return Err(AppError::Io(format!("git worktree add thất bại: {}", output.stderr().trim())));
        }
        self.registry.take_grant(token)?;
        Ok(dest_text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{TestRepo, core_with, open};

    #[test]
    fn branch_args_and_worktree_list_parsing() {
        assert!(validate_branch_arg("feature/x").is_ok());
        for bad in ["", "-b", "--detach", "a b", "x\ny"] {
            assert!(validate_branch_arg(bad).is_err(), "{bad:?}");
        }
        let output = "worktree /a/repo\0HEAD abc\0branch refs/heads/main\0\0worktree /a/repo-x\0HEAD def\0detached\0\0";
        assert_eq!(parse_worktree_paths(output), [PathBuf::from("/a/repo"), PathBuf::from("/a/repo-x")]);
    }

    #[tokio::test]
    async fn adds_a_worktree_in_the_picked_folder_and_only_opens_real_worktrees_and_submodules() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1\n");
        repo.commit_all("gốc");
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        let id = &opened.repo_id;

        let parent = repo.tmp().join("noi-dat");
        std::fs::create_dir_all(&parent).unwrap();
        let picked = core.registry.grant_folder(&parent);
        let path = core.git_worktree_add(id, &picked.token, "repo-tinh-nang", "tinh-nang", true, None).await.unwrap();
        assert!(Path::new(&path).join("a.txt").exists());
        assert_eq!(repo.git(&["branch", "--list", "tinh-nang"]).trim(), "+ tinh-nang");
        // the token is single-use; a branch starting with `-` is blocked before git runs
        assert!(core.git_worktree_add(id, &picked.token, "khac", "khac", true, None).await.is_err());
        let picked = core.registry.grant_folder(&parent);
        assert_eq!(core.git_worktree_add(id, &picked.token, "x", "--detach", false, None).await.unwrap_err().code(), "policy");

        assert_eq!(core.related_repo_path(id, RelatedKind::Worktree, &path).await.unwrap(), canonical(Path::new(&path)).unwrap());
        // An arbitrary directory (even tmp itself) is not a worktree → rejected.
        let stranger = repo.tmp().to_string_lossy().into_owned();
        assert_eq!(core.related_repo_path(id, RelatedKind::Worktree, &stranger).await.unwrap_err().code(), "policy");

        // Submodule: only a real gitlink in the index.
        let sub = TestRepo::new();
        sub.write("s.txt", "s\n");
        sub.commit_all("sub");
        repo.git(&["-c", "protocol.file.allow=always", "submodule", "add", "-q", &sub.root().to_string_lossy(), "vendor/lib"]);
        repo.git(&["commit", "-qm", "thêm submodule"]);
        let dir = core.related_repo_path(id, RelatedKind::Submodule, "vendor/lib").await.unwrap();
        assert!(dir.ends_with("vendor/lib"));
        for bad in ["a.txt", "../x", "vendor/../vendor/lib", "", "khong-co"] {
            assert!(core.related_repo_path(id, RelatedKind::Submodule, bad).await.is_err(), "{bad}");
        }
    }
}
