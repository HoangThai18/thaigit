//! Interactive rebase (`git_rebase_interactive`) — a typed command that does NOT go through `git_exec`: `git rebase -i`
//! needs a sequence editor, and a new message only runs through an `exec` line in the todo file, i.e. it runs a shell
//! command. The webview (untrusted) only sends a structured plan (sha + action + message); Rust validates every entry and
//! composes the todo and message files ITSELF under `<gitDir>/thaigit-rebase/`.
//!
//! - The sequence editor uses only the shell's built-ins (`read` / `printf`) to copy the app's todo file over git's — it calls
//!   no external program and works with Git for Windows' `sh` too. It is set through `GIT_SEQUENCE_EDITOR`, so it takes
//!   precedence over a repo's own `sequence.editor`.
//! - Reword = `pick` followed by `exec git commit --amend … -F <message file>` (no editor opens). The policy's safe `-c`
//!   flags carry over to that child `git` through `GIT_CONFIG_PARAMETERS` (git passes them on itself).
//! - `squash` keeps the message of both commits: the policy's `GIT_EDITOR=true` accepts the message git already merged.
//! - On a conflict git stops like a normal rebase; the app shows Continue / Skip / Cancel (the usual `rebase
//!   --continue|--skip|--abort` commands). The message files must still be there at that point, so they are only cleaned up
//!   during the next interactive rebase.

use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::core::{Core, SpawnOptions};
use crate::errors::{AppError, Result};
use crate::exec::CancelToken;
use crate::locks::Holder;
use crate::policy::EnvProfile;

/// Max commits in one plan.
const MAX_STEPS: usize = 2000;
/// Max length of a new message, in bytes.
const MAX_MESSAGE: usize = 64 * 1024;
const DIR_NAME: &str = "thaigit-rebase";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RebaseAction {
    Pick,
    Reword,
    Squash,
    Fixup,
    Drop,
}

/// One line of the plan (matching `RebaseStepRequest` in `packages/contracts/src/ipc.ts`). Ordered oldest → newest, exactly the order they are applied.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseStep {
    pub action: RebaseAction,
    pub sha: String,
    /// The new message — required for `reword`, ignored for any other action.
    #[serde(default)]
    pub message: Option<String>,
}

/// The result (matching `RebaseResult`): a non-zero exit code means git stopped part-way (a conflict…) — the TS side builds a `GitError` from it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RebaseOutcome {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

fn is_object_id(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Validate the plan: full shas (no refs, no flags), no duplicates, valid messages, and the oldest remaining commit is not a squash/fixup.
pub fn validate_plan(onto: &str, steps: &[RebaseStep]) -> Result<()> {
    if !is_object_id(onto) {
        return Err(AppError::policy("`onto` phải là sha đầy đủ"));
    }
    if steps.is_empty() || steps.len() > MAX_STEPS {
        return Err(AppError::policy(format!("kế hoạch rebase phải có 1–{MAX_STEPS} commit")));
    }
    let mut seen = HashSet::new();
    for step in steps {
        if !is_object_id(&step.sha) {
            return Err(AppError::policy("sha trong kế hoạch rebase không hợp lệ"));
        }
        if !seen.insert(step.sha.to_ascii_lowercase()) {
            return Err(AppError::policy("một commit xuất hiện hai lần trong kế hoạch rebase"));
        }
        if step.action == RebaseAction::Reword {
            let message = step.message.as_deref().unwrap_or("");
            if message.trim().is_empty() || message.len() > MAX_MESSAGE || message.contains('\0') {
                return Err(AppError::policy("message mới rỗng, quá dài hoặc chứa NUL"));
            }
        }
    }
    let first_kept = steps.iter().find(|step| step.action != RebaseAction::Drop);
    if first_kept.is_some_and(|step| matches!(step.action, RebaseAction::Squash | RebaseAction::Fixup)) {
        return Err(AppError::policy("commit cũ nhất còn lại không gộp được vào commit nào"));
    }
    Ok(())
}

/// Wrap in single quotes for `sh` (`it's` → `'it'\''s'`).
pub fn sh_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', r"'\''"))
}

/// A path `sh` can read (Windows: `C:/…` instead of `C:\…`); rejected when it is not UTF-8.
fn sh_path(path: &Path) -> Result<String> {
    let text = path.to_str().ok_or_else(|| AppError::Io("đường dẫn repo không phải UTF-8".into()))?;
    Ok(if cfg!(windows) { text.replace('\\', "/") } else { text.to_string() })
}

/// The todo file content. `message_file(i)` is the `sh`-form path of the i-th line's message file.
pub fn build_todo(steps: &[RebaseStep], message_file: impl Fn(usize) -> String) -> String {
    let mut lines = Vec::with_capacity(steps.len());
    for (index, step) in steps.iter().enumerate() {
        let sha = step.sha.to_ascii_lowercase();
        match step.action {
            RebaseAction::Pick => lines.push(format!("pick {sha}")),
            RebaseAction::Reword => {
                lines.push(format!("pick {sha}"));
                lines.push(format!(
                    "exec git commit --amend --only --no-verify --allow-empty --cleanup=whitespace -F {}",
                    sh_quote(&message_file(index))
                ));
            }
            RebaseAction::Squash => lines.push(format!("squash {sha}")),
            RebaseAction::Fixup => lines.push(format!("fixup {sha}")),
            RebaseAction::Drop => lines.push(format!("drop {sha}")),
        }
    }
    let mut todo = lines.join("\n");
    todo.push('\n');
    todo
}

/// The sequence editor: git runs `sh -c '<editor> "$@"' … <git's todo file>` → copy each line of the app's todo file over.
pub fn sequence_editor(todo_path: &str) -> String {
    format!("while IFS= read -r line; do printf '%s\\n' \"$line\"; done < {} >", sh_quote(todo_path))
}

impl Core {
    /// `git_rebase_interactive`: rebase the current branch onto `onto` following the plan `steps`, auto-stashing and restoring
    /// uncommitted changes (`--autostash`). It holds the repo's write lock like any normal `write` command.
    pub async fn git_rebase_interactive(&self, repo_id: &str, onto: &str, steps: &[RebaseStep]) -> Result<RebaseOutcome> {
        validate_plan(onto, steps)?;
        let entry = self.registry.get(repo_id)?;
        if entry.restrictions.as_ref().is_some_and(|r| r.fail_closed) {
            return Err(AppError::Untrusted(
                "Repo chưa được tin cậy và có cấu hình không thể vô hiệu hoá trước nên không rebase được. Hãy tin tưởng repo để tiếp tục.".into(),
            ));
        }

        let directory = entry.git_dir.join(DIR_NAME);
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).map_err(|e| AppError::Io(format!("không tạo được thư mục rebase: {e}")))?;
        let message_path = |index: usize| directory.join(format!("message-{index}"));
        for (index, step) in steps.iter().enumerate() {
            if step.action == RebaseAction::Reword {
                let message = step.message.as_deref().unwrap_or("");
                std::fs::write(message_path(index), message).map_err(|e| AppError::Io(format!("không ghi được message: {e}")))?;
            }
        }
        let mut message_files = Vec::with_capacity(steps.len());
        for index in 0..steps.len() {
            message_files.push(sh_path(&message_path(index))?);
        }
        let todo = build_todo(steps, |index| message_files[index].clone());
        let todo_path = directory.join("todo");
        std::fs::write(&todo_path, todo).map_err(|e| AppError::Io(format!("không ghi được file todo: {e}")))?;

        let mut caller_env = BTreeMap::new();
        caller_env.insert("GIT_SEQUENCE_EDITOR".to_string(), sequence_editor(&sh_path(&todo_path)?));
        let args: Vec<String> =
            ["-i", "--autostash", "--no-autosquash", onto].iter().map(|arg| arg.to_string()).collect();

        let git = self.require_git("rebase")?;
        let spec = self.build_spec(
            &git,
            SpawnOptions {
                cwd: &entry.root,
                sub: "rebase",
                args: &args,
                stdin: None,
                profile: EnvProfile::Background,
                caller_env,
                restrictions: entry.restrictions.as_ref(),
            },
        );
        let lock = self.locks.for_key(&entry.common_key);
        let cancel = CancelToken::new();
        let holder = Holder { op_id: format!("rebase-i-{}", entry.id), background: false, cancel: cancel.clone() };
        let guard = lock.acquire(holder, None).await.map_err(AppError::from)?;
        let output = self.run_spec(spec, Some(Duration::from_secs(30 * 60))).await;
        drop(guard);
        let output = output?;
        Ok(RebaseOutcome { exit_code: output.exit.code, stdout: output.stdout(), stderr: output.stderr() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::policy;
    use crate::testutil::{TestRepo, core_with, open};

    fn step(action: RebaseAction, sha: &str, message: Option<&str>) -> RebaseStep {
        RebaseStep { action, sha: sha.to_string(), message: message.map(str::to_string) }
    }

    const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    #[test]
    fn plan_validation_rejects_refs_flags_duplicates_and_leading_squash() {
        assert!(validate_plan(A, &[step(RebaseAction::Pick, B, None)]).is_ok());
        for onto in ["HEAD", "--exec=id", "abc", ""] {
            assert_eq!(validate_plan(onto, &[step(RebaseAction::Pick, B, None)]).unwrap_err().code(), "policy", "{onto}");
        }
        for sha in ["HEAD~1", "-x", "main", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\nexec id"] {
            assert_eq!(validate_plan(A, &[step(RebaseAction::Pick, sha, None)]).unwrap_err().code(), "policy", "{sha:?}");
        }
        assert!(validate_plan(A, &[]).is_err());
        assert!(validate_plan(A, &[step(RebaseAction::Pick, B, None), step(RebaseAction::Drop, B, None)]).is_err());
        assert!(validate_plan(A, &[step(RebaseAction::Reword, B, Some("  \n"))]).is_err());
        assert!(validate_plan(A, &[step(RebaseAction::Reword, B, Some("a\0b"))]).is_err());
        assert!(validate_plan(A, &[step(RebaseAction::Drop, A, None), step(RebaseAction::Fixup, B, None)]).is_err());
    }

    #[test]
    fn todo_quotes_message_files_and_never_carries_message_text() {
        let steps = [
            step(RebaseAction::Pick, A, None),
            step(RebaseAction::Reword, B, Some("x'; touch /tmp/pwned; echo '")),
        ];
        let todo = build_todo(&steps, |index| format!("/repo's/.git/thaigit-rebase/message-{index}"));
        assert_eq!(
            todo,
            format!(
                "pick {A}\npick {B}\nexec git commit --amend --only --no-verify --allow-empty --cleanup=whitespace -F '/repo'\\''s/.git/thaigit-rebase/message-1'\n"
            )
        );
        assert!(!todo.contains("pwned"));
        assert_eq!(sequence_editor("/a b/todo"), "while IFS= read -r line; do printf '%s\\n' \"$line\"; done < '/a b/todo' >");
        // The policy still treats `rebase` as a write command (per-repo lock, which this command holds itself).
        assert_eq!(policy().derived_kind("rebase", &["-i".to_string()]), Some(crate::policy::ExecKind::Write));
    }

    fn head_subjects(repo: &TestRepo, count: usize) -> Vec<String> {
        repo.git(&["log", "--format=%s", &format!("-n{count}")]).lines().map(str::to_string).collect()
    }

    #[tokio::test]
    async fn rebase_reorders_rewords_squashes_and_drops_without_any_editor() {
        let repo = TestRepo::new();
        repo.write("a.txt", "gốc\n");
        repo.commit_all("gốc");
        let onto = repo.git(&["rev-parse", "HEAD"]).trim().to_string();
        let mut shas = Vec::new();
        for name in ["một", "hai", "ba", "bốn"] {
            repo.write(&format!("{name}.txt"), &format!("{name}\n"));
            repo.commit_all(name);
            shas.push(repo.git(&["rev-parse", "HEAD"]).trim().to_string());
        }
        // A repo setting its own sequence.editor / core.editor: never run.
        let marker = repo.tmp().join("editor-ran");
        let evil = format!("touch {}", sh_quote(&marker.to_string_lossy()));
        repo.git(&["config", "sequence.editor", &evil]);
        repo.git(&["config", "core.editor", &evil]);
        repo.write("dang-sua.txt", "chưa commit\n");

        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        core.trust_repo(&opened.repo_id).await.unwrap();
        let steps = vec![
            step(RebaseAction::Pick, &shas[2], None),
            step(RebaseAction::Reword, &shas[0], Some("Một — message mới\n\nThân có # không bị bỏ\n")),
            step(RebaseAction::Fixup, &shas[1], None),
            step(RebaseAction::Drop, &shas[3], None),
        ];
        let outcome = core.git_rebase_interactive(&opened.repo_id, &onto, &steps).await.unwrap();
        assert_eq!(outcome.exit_code, 0, "{}", outcome.stderr);
        assert_eq!(head_subjects(&repo, 3), ["Một — message mới", "ba", "gốc"]);
        assert_eq!(repo.git(&["log", "-1", "--format=%B"]).trim_end(), "Một — message mới\n\nThân có # không bị bỏ");
        assert!(repo.exists("hai.txt"), "fixup giữ thay đổi của commit bị gộp");
        assert!(!repo.exists("bốn.txt"), "drop bỏ commit");
        assert_eq!(String::from_utf8(repo.read("dang-sua.txt")).unwrap(), "chưa commit\n", "autostash trả lại thay đổi");
        assert!(!marker.exists(), "editor do repo đặt không được chạy");
    }

    #[tokio::test]
    async fn conflicts_stop_like_a_normal_rebase_and_squash_keeps_both_messages() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1\n");
        repo.commit_all("gốc");
        let onto = repo.git(&["rev-parse", "HEAD"]).trim().to_string();
        repo.write("a.txt", "2\n");
        repo.commit_all("hai");
        let two = repo.git(&["rev-parse", "HEAD"]).trim().to_string();
        repo.write("a.txt", "3\n");
        repo.commit_all("ba");
        let three = repo.git(&["rev-parse", "HEAD"]).trim().to_string();
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        core.trust_repo(&opened.repo_id).await.unwrap();

        let squashed = [step(RebaseAction::Pick, &two, None), step(RebaseAction::Squash, &three, None)];
        let outcome = core.git_rebase_interactive(&opened.repo_id, &onto, &squashed).await.unwrap();
        assert_eq!(outcome.exit_code, 0, "{}", outcome.stderr);
        let message = repo.git(&["log", "-1", "--format=%B"]);
        assert!(message.contains("hai") && message.contains("ba"), "{message}");

        // Reordering two commits editing the same line → a conflict, git stops (rebase-merge is left behind) like a normal rebase.
        let head = repo.git(&["rev-parse", "HEAD"]).trim().to_string();
        repo.git(&["reset", "-q", "--hard", &three]);
        let swapped = [step(RebaseAction::Pick, &three, None), step(RebaseAction::Pick, &two, None)];
        let outcome = core.git_rebase_interactive(&opened.repo_id, &onto, &swapped).await.unwrap();
        assert_ne!(outcome.exit_code, 0);
        assert!(repo.root().join(".git/rebase-merge").is_dir());
        repo.git(&["rebase", "--abort"]);
        assert_eq!(repo.git(&["rev-parse", "HEAD"]).trim(), three);
        assert_ne!(head, three);
    }

    #[tokio::test]
    async fn bad_plans_never_touch_the_repo() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1\n");
        repo.commit_all("gốc");
        let head = repo.git(&["rev-parse", "HEAD"]).trim().to_string();
        let (core, _data) = core_with(&repo).await;
        let opened = open(&core, &repo).await;
        let error = core
            .git_rebase_interactive(&opened.repo_id, "HEAD~1", &[step(RebaseAction::Pick, &head, None)])
            .await
            .unwrap_err();
        assert_eq!(error.code(), "policy");
        assert!(!repo.root().join(".git").join(DIR_NAME).exists());
    }
}
