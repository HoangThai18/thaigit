// Rebase tương tác: mở hộp thoại từ một commit trên graph (các commit SAU nó tới HEAD được viết lại) và chạy kế hoạch.
// Xung đột dừng giữa chừng như rebase thường (thanh Tiếp tục / Bỏ qua / Huỷ); xong thì có Hoàn tác (đưa nhánh về như cũ).

import { shortSha, type Commit } from '@thaigit/core';
import { onConflict } from '../actions/history.ts';
import { vi } from '../strings.vi.ts';
import { Scope, type RepoStore } from '../stores/repo.svelte.ts';
import { RebaseSession, rebaseEditor } from './rebaseEditor.svelte.ts';

export async function beginInteractiveRebase(store: RepoStore, base: Commit): Promise<void> {
  const branch = store.currentBranch;
  if (branch === null) {
    store.notify('warning', vi.rebase.needBranch);
    return;
  }
  if (store.operation !== null) {
    store.notify('warning', vi.rebase.operationInProgress);
    return;
  }
  let commits: Commit[] | null;
  try {
    commits = await store.git.rebaseCommits(base.id);
  } catch (error) {
    store.showError(vi.rebase.loadFailed, error);
    return;
  }
  if (commits === null) {
    store.notify('warning', vi.rebase.notOnBranch(shortSha(base)));
    return;
  }
  if (commits.length === 0) {
    store.notify('info', vi.rebase.nothingAfter);
    return;
  }
  rebaseEditor.open(new RebaseSession(base, branch, commits, (sha) => store.git.commitMessage(sha)));
}

/** Chạy kế hoạch đang soạn (đóng hộp thoại trước — lỗi / xung đột hiện như mọi thao tác khác). */
export async function runInteractiveRebase(store: RepoStore, session: RebaseSession): Promise<void> {
  if (session.problem !== null) return;
  rebaseEditor.close();
  const branch = session.branch;
  const previousHead = store.headOid;
  const steps = session.steps;
  let outcome: 'done' | 'autostashConflict' = 'done';
  await store.perform(
    vi.rebase.running(branch),
    async (git) => {
      outcome = await git.interactiveRebase(session.base.id, steps);
    },
    {
      refresh: Scope.all,
      onSuccess: () => {
        if (outcome === 'autostashConflict') {
          store.notify('warning', vi.rebase.autostashConflict);
          return;
        }
        store.notify('success', vi.rebase.done(branch), {
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
        });
      },
      onError: onConflict(store, 'Rebase'),
    },
  );
}
