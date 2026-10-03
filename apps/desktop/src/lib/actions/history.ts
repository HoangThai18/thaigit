// Merge / rebase / cherry-pick / revert / reset / huỷ tất cả thay đổi / thao tác dở dang (port RepoModel+Actions.swift).
// Thao tác viết lại lịch sử đều có "Hoàn tác" (reset --merge về HEAD cũ — giữ thay đổi chưa commit); thao tác mất dữ liệu
// (reset cứng, huỷ tất cả) hỏi trước.

import {
  isMergeCommit,
  isStatusClean,
  operationCanContinue,
  operationCanSkip,
  operationShortName,
  operationTitle,
  shortSha,
  type Commit,
  type ResetMode,
} from '@thaigit/core';
import { vi } from '../strings.vi.ts';
import { splitMessage } from './commit.ts';
import { dialogs as globalDialogs, type DialogStore } from '../stores/dialogs.svelte.ts';
import { Scope, type RepoStore } from '../stores/repo.svelte.ts';
import { handleConflictError } from './errors.ts';
import { quickStash } from './stash.ts';

/** Nút "Hoàn tác" đưa nhánh hiện tại về `head` (giữ thay đổi chưa commit). */
function undoTo(store: RepoStore, title: string, head: string | null): { title: string; run: () => void }[] {
  if (head === null) return [];
  return [
    {
      title: vi.staging.undo,
      run: () =>
        void store.perform(title, (git) => git.resetKeepingLocalChanges(head), {
          refresh: Scope.all,
          onSuccess: () => store.notify('success', vi.staging.undone),
        }),
    },
  ];
}

/** Đang merge / revert / cherry-pick dở: điền sẵn message (MERGE_MSG) vào ô commit nếu ô đang trống. */
export async function prefillPendingMessage(store: RepoStore): Promise<void> {
  const draft = store.commitDraft;
  if (draft.summary.trim() !== '' || draft.body.trim() !== '') return;
  const pending = await store.git.pendingCommitMessage().catch(() => null);
  if (!pending) return;
  const message = splitMessage(pending);
  draft.summary = message.summary;
  draft.body = message.body;
}

function onConflict(store: RepoStore, operation: string): (error: unknown) => boolean {
  return (error) => {
    const handled = handleConflictError(store, error, operation, () => void quickStash(store));
    if (handled) void prefillPendingMessage(store);
    return handled;
  };
}

/** Merge `ref` (tên nhánh / tag / SHA) vào nhánh hiện tại. */
export function merge(store: RepoStore, ref: string, label: string): Promise<void> {
  const current = store.currentBranch;
  if (current === null) {
    store.notify('warning', vi.branches.needBranchToMerge);
    return Promise.resolve();
  }
  const previousHead = store.headOid;
  return store.perform(vi.branches.mergeTitle(label, current), (git) => git.merge(ref), {
    refresh: Scope.all,
    onSuccess: () =>
      store.notify('success', vi.branches.merged(label, current), {
        actions: undoTo(store, vi.branches.undoMerge, previousHead),
      }),
    onError: onConflict(store, 'Merge'),
  });
}

/** Rebase nhánh hiện tại lên `onto` (hỏi trước vì viết lại lịch sử). */
export function rebaseCurrent(store: RepoStore, onto: string, label: string, dialogs?: DialogStore): Promise<void> {
  const current = store.currentBranch;
  if (current === null) {
    store.notify('warning', vi.branches.needBranchToRebase);
    return Promise.resolve();
  }
  return rebase(store, current, onto, label, false, dialogs);
}

/** Rebase `branch` lên `onto`; `switches` = checkout `branch` trước (git tự làm khi truyền tên nhánh). */
export async function rebase(
  store: RepoStore,
  branch: string,
  onto: string,
  label: string,
  switches: boolean,
  dialogs?: DialogStore,
): Promise<void> {
  const confirmed = await (dialogs ?? globalDialogs).confirm({
    title: vi.branches.rebaseConfirmTitle(branch, label),
    message: vi.branches.rebaseConfirmMessage(branch, label),
    confirmTitle: vi.branches.rebase,
  });
  if (!confirmed) return;
  const previousHead = store.localBranches.find((ref) => ref.fullName === `refs/heads/${branch}`)?.target ?? null;
  await store.perform(vi.branches.rebaseTitle(branch, label), (git) => git.rebase(onto, switches ? branch : null), {
    refresh: Scope.all,
    onSuccess: () =>
      store.notify('success', vi.branches.rebased(branch, label), {
        actions:
          previousHead === null
            ? []
            : [
                {
                  title: vi.staging.undo,
                  run: () =>
                    void store.perform(
                      vi.branches.undoRebase,
                      async (git) => {
                        await git.switchTo(branch);
                        await git.resetKeepingLocalChanges(previousHead);
                      },
                      { refresh: Scope.all, onSuccess: () => store.notify('success', vi.staging.undone) },
                    ),
                },
              ],
      }),
    onError: onConflict(store, 'Rebase'),
  });
}

export function cherryPick(store: RepoStore, commit: Commit): Promise<void> {
  const previousHead = store.headOid;
  return store.perform(
    vi.branches.cherryPickTitle(shortSha(commit)),
    (git) => git.cherryPick(commit.id, isMergeCommit(commit) ? 1 : null),
    {
      refresh: Scope.all,
      onSuccess: () =>
        store.notify('success', vi.branches.cherryPicked(commit.subject), {
          actions: undoTo(store, vi.branches.undoCherryPick, previousHead),
        }),
      onError: onConflict(store, 'Cherry-pick'),
    },
  );
}

/**
 * Revert, hỏi trước như GitKraken: "Revert & commit" ngay, hoặc "Revert, chưa commit" — chỉ stage thay đổi đảo ngược
 * (repo ở trạng thái "Đang revert", ô commit điền sẵn message) để xem lại / sửa rồi tự commit.
 */
export async function revert(store: RepoStore, commit: Commit, dialogs?: DialogStore): Promise<void> {
  const sha = shortSha(commit);
  const parts = [vi.branches.revertConfirmMessage(store.currentBranch ?? 'HEAD', sha)];
  const firstParent = commit.parents[0];
  if (isMergeCommit(commit) && firstParent) parts.push(vi.branches.revertMergeNote(firstParent.slice(0, 7)));
  parts.push(vi.branches.revertNoCommitNote);
  const answer = await (dialogs ?? globalDialogs).ask({
    title: vi.branches.revertConfirmTitle(commit.subject),
    message: parts.join('\n\n'),
    confirmTitle: vi.branches.revertAndCommit,
    secondaryTitle: vi.branches.revertNoCommit,
  });
  if (answer === 'cancel') return;
  const mainline = isMergeCommit(commit) ? 1 : null;
  if (answer === 'secondary') {
    // `revert --no-commit` gộp luôn thay đổi đã stage sẵn vào revert (và "Hoàn tác" = revert --abort sẽ xoá chúng): chặn.
    if (store.status.staged.length > 0) {
      store.notify('warning', vi.branches.revertBlockedByStaged, {
        message: vi.branches.revertBlockedMessage,
        actions: [{ title: vi.remote.stashChanges, run: () => void quickStash(store) }],
      });
      return;
    }
    await store.perform(vi.branches.revertNoCommitTitle(sha), (git) => git.revert(commit.id, mainline, false), {
      refresh: Scope.all,
      onSuccess: () => {
        store.select({ kind: 'workingTree' }, true);
        void prefillPendingMessage(store);
        store.notify('success', vi.branches.revertedNoCommit(commit.subject), {
          actions: [
            {
              title: vi.staging.undo,
              run: () =>
                void store.perform(vi.branches.undoRevert, (git) => git.abort({ kind: 'reverting' }), {
                  refresh: Scope.all,
                  onSuccess: () => {
                    store.commitDraft.summary = '';
                    store.commitDraft.body = '';
                    store.notify('success', vi.staging.undone);
                  },
                }),
            },
          ],
        });
      },
      onError: onConflict(store, 'Revert'),
    });
    return;
  }
  const previousHead = store.headOid;
  await store.perform(vi.branches.revertTitle(sha), (git) => git.revert(commit.id, mainline), {
    refresh: Scope.all,
    onSuccess: () =>
      store.notify('success', vi.branches.reverted(commit.subject), {
        actions: undoTo(store, vi.branches.undoRevert, previousHead),
      }),
    onError: onConflict(store, 'Revert'),
  });
}

/** Reset nhánh hiện tại về `commit`. Hard thì hỏi trước (mất thay đổi chưa commit). */
export async function reset(store: RepoStore, commit: Commit, mode: ResetMode, dialogs?: DialogStore): Promise<void> {
  const target = store.currentBranch ?? 'HEAD';
  const sha = shortSha(commit);
  if (mode === 'hard') {
    const confirmed = await (dialogs ?? globalDialogs).confirm({
      title: vi.branches.resetHardConfirmTitle(target, sha),
      message: vi.branches.resetHardConfirmMessage(sha),
      confirmTitle: vi.branches.resetHard,
      destructive: true,
    });
    if (!confirmed) return;
  }
  const previousHead = store.headOid;
  await store.perform(vi.branches.resetTitle(target, mode), (git) => git.reset(commit.id, mode), {
    refresh: Scope.all,
    onSuccess: () =>
      store.notify('success', vi.branches.resetDone(target, sha), {
        actions:
          previousHead === null
            ? []
            : [
                {
                  title: vi.staging.undo,
                  run: () =>
                    void store.perform(
                      vi.branches.undoReset,
                      (git) => git.reset(previousHead, mode === 'hard' ? 'hard' : 'soft'),
                      { refresh: Scope.all, onSuccess: () => store.notify('success', vi.staging.undone) },
                    ),
                },
              ],
      }),
  });
}

/**
 * Huỷ TẤT CẢ thay đổi chưa commit (kể cả đã stage): chụp lại bằng `stash create`, reset --hard, dời file mới vào thùng rác của
 * app. "Hoàn tác" áp lại bản chụp (giữ cả index) và trả file mới.
 */
export async function discardAll(store: RepoStore, dialogs?: DialogStore): Promise<void> {
  if (isStatusClean(store.status)) return;
  if (store.operation) {
    store.notify('warning', vi.branches.useOperationBanner(operationTitle(store.operation)));
    return;
  }
  const confirmed = await (dialogs ?? globalDialogs).confirm({
    title: vi.branches.discardAllConfirmTitle,
    message: vi.branches.discardAllConfirmMessage,
    confirmTitle: vi.branches.discardAll,
    destructive: true,
  });
  if (!confirmed) return;
  const untracked = store.status.unstaged.filter((change) => change.kind === 'untracked').map((change) => change.path);
  let snapshot: string | null = null;
  let trashToken: string | null = null;
  await store.perform(
    vi.branches.discardAllTitle,
    async (git) => {
      snapshot = await git.snapshotChanges();
      await git.hardReset();
      if (untracked.length > 0) trashToken = await git.trashUntracked(untracked);
    },
    {
      refresh: Scope.all,
      onSuccess: () => {
        const restoreSnapshot = snapshot;
        const restoreToken = trashToken;
        store.notify('success', vi.branches.discardedAll, {
          actions: [
            {
              title: vi.staging.undo,
              run: () =>
                void store.perform(
                  vi.branches.undoDiscardAll,
                  async (git) => {
                    if (restoreSnapshot !== null) await git.stashApply(restoreSnapshot, true);
                    if (restoreToken !== null) await git.restoreTrash(restoreToken);
                  },
                  { refresh: Scope.all, onSuccess: () => store.notify('success', vi.staging.undone) },
                ),
            },
          ],
        });
      },
    },
  );
}

export function ignore(store: RepoStore, pattern: string): Promise<void> {
  return store.perform(vi.branches.ignoreTitle, (git) => git.addToGitignore(pattern), {
    refresh: Scope.status,
    onSuccess: () => store.notify('success', vi.branches.ignored(pattern)),
  });
}

// MARK: - Thao tác dở dang (banner)

export function continueOperation(store: RepoStore): Promise<void> {
  const operation = store.operation;
  if (!operation || !operationCanContinue(operation)) return Promise.resolve();
  if (store.status.conflicts.length > 0) {
    store.notify('warning', vi.branches.conflictsLeft(store.status.conflicts.length));
    return Promise.resolve();
  }
  const name = operationShortName(operation);
  return store.perform(vi.branches.continueTitle(name), (git) => git.continueOperation(operation), {
    refresh: Scope.all,
    onSuccess: () => {
      store.commitDraft.summary = '';
      store.commitDraft.body = '';
      store.notify('success', vi.branches.continued);
    },
    onError: onConflict(store, operationTitle(operation)),
  });
}

export async function abortOperation(store: RepoStore, dialogs?: DialogStore): Promise<void> {
  const operation = store.operation;
  if (!operation) return;
  const name = operationShortName(operation);
  const confirmed = await (dialogs ?? globalDialogs).confirm({
    title: vi.branches.abortConfirmTitle(name),
    message: vi.branches.abortConfirmMessage(name),
    confirmTitle: vi.branches.abortTitle(name),
    destructive: true,
  });
  if (!confirmed) return;
  await store.perform(vi.branches.abortTitle(name), (git) => git.abort(operation), {
    refresh: Scope.all,
    onSuccess: () => {
      store.commitDraft.summary = '';
      store.commitDraft.body = '';
      store.notify('success', vi.branches.aborted(name));
    },
  });
}

export function skipOperation(store: RepoStore): Promise<void> {
  const operation = store.operation;
  if (!operation || !operationCanSkip(operation)) return Promise.resolve();
  return store.perform(vi.branches.skipTitle, (git) => git.skip(operation), {
    refresh: Scope.all,
    onError: onConflict(store, operationTitle(operation)),
  });
}
