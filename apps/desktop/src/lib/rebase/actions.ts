// Rebase tương tác: mở hộp thoại từ một commit trên graph (các commit SAU nó tới HEAD được viết lại) và chạy kế hoạch.
// Xung đột dừng giữa chừng như rebase thường (thanh Tiếp tục / Bỏ qua / Huỷ); xong thì có Hoàn tác (đưa nhánh về như cũ).

import {
  rebasePlanProblem,
  shortSha,
  type Commit,
  type RebasePlanProblem,
  type RebaseStep,
} from '@thaigit/core';
import { onConflict } from '../actions/history.ts';
import { vi } from '../strings.vi.ts';
import { dialogs, textValue } from '../stores/dialogs.svelte.ts';
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
  await runRebasePlan(store, session.base.id, session.branch, session.steps, vi.rebase.done(session.branch));
}

/** Chạy một kế hoạch rebase (cũ → mới) lên `onto`; xong thì báo `doneText` kèm nút Hoàn tác (đưa nhánh về như cũ). */
async function runRebasePlan(
  store: RepoStore,
  onto: string,
  branch: string,
  steps: readonly RebaseStep[],
  doneText: string,
): Promise<void> {
  const previousHead = store.headOid;
  let outcome: 'done' | 'autostashConflict' = 'done';
  await store.perform(
    vi.rebase.running(branch),
    async (git) => {
      outcome = await git.interactiveRebase(onto, steps);
    },
    {
      refresh: Scope.all,
      onSuccess: () => {
        if (outcome === 'autostashConflict') {
          store.notify('warning', vi.rebase.autostashConflict);
          return;
        }
        store.notify('success', doneText, {
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

export function rebaseProblemText(value: RebasePlanProblem): string {
  switch (value) {
    case 'empty':
      return vi.rebase.problemEmpty;
    case 'merge':
      return vi.rebase.problemMerge;
    case 'leadingSquash':
      return vi.rebase.problemLeadingSquash;
    case 'emptyMessage':
      return vi.rebase.problemEmptyMessage;
    case 'allDropped':
      return vi.rebase.problemAllDropped;
    case 'unchanged':
      return vi.rebase.problemUnchanged;
  }
}

// --- Thao tác nhanh trên một commit (menu chuột phải, như GitKraken): rebase tương tác dựng sẵn kế hoạch -----------------

/** Sửa message / xoá / đổi chỗ chỉ áp dụng cho commit thường (một cha) khi đang đứng trên nhánh, không có thao tác dở. */
export function canRewriteCommit(store: RepoStore, commit: Commit): boolean {
  return commit.parents.length === 1 && store.currentBranch !== null && store.operation === null;
}

/** Nhánh hiện tại + các commit sau `base` (cũ → mới) có chứa `sha`; `null` (đã báo người dùng) nếu không rebase được. */
async function rewritable(
  store: RepoStore,
  base: string,
  sha: string,
): Promise<{ branch: string; commits: Commit[] } | null> {
  const branch = store.currentBranch;
  if (branch === null) {
    store.notify('warning', vi.rebase.needBranch);
    return null;
  }
  if (store.operation !== null) {
    store.notify('warning', vi.rebase.operationInProgress);
    return null;
  }
  let commits: Commit[] | null;
  try {
    commits = await store.git.rebaseCommits(base);
  } catch (error) {
    store.showError(vi.rebase.loadFailed, error);
    return null;
  }
  if (commits === null || !commits.some((commit) => commit.id === sha)) {
    store.notify('warning', vi.rebase.notOnBranch(sha.slice(0, 7)));
    return null;
  }
  return { branch, commits };
}

/** Kiểm kế hoạch dựng sẵn rồi chạy; kế hoạch không hợp lệ (có commit merge…) thì báo lý do. */
async function runQuickPlan(
  store: RepoStore,
  base: string,
  branch: string,
  original: readonly Commit[],
  steps: readonly RebaseStep[],
  doneText: string,
): Promise<void> {
  const problem = rebasePlanProblem(steps, original);
  if (problem !== null) {
    store.notify('warning', rebaseProblemText(problem));
    return;
  }
  await runRebasePlan(store, base, branch, steps, doneText);
}

function picks(commits: readonly Commit[]): RebaseStep[] {
  return commits.map((commit) => ({ commit, action: 'pick' }));
}

export async function rewordCommit(store: RepoStore, commit: Commit): Promise<void> {
  const base = commit.parents[0];
  if (base === undefined || commit.parents.length !== 1) return;
  const plan = await rewritable(store, base, commit.id);
  if (plan === null) return;
  let current: string;
  try {
    current = await store.git.commitMessage(commit.id);
  } catch (error) {
    store.showError(vi.rebase.loadFailed, error);
    return;
  }
  const values = await dialogs.form({
    title: vi.rebase.rewordTitle,
    message: vi.rebase.rewordMessage(shortSha(commit)),
    fields: [{ kind: 'multiline', id: 'message', label: vi.rebase.rewordField, value: current.trimEnd() }],
    confirmTitle: vi.rebase.rewordConfirm,
    validate: (form) => (textValue(form, 'message') === '' ? vi.rebase.problemEmptyMessage : null),
  });
  if (values === null) return;
  const message = typeof values.message === 'string' ? values.message.trim() : '';
  if (message === current.trim()) return;
  const steps = plan.commits.map((item): RebaseStep =>
    item.id === commit.id ? { commit: item, action: 'reword', message } : { commit: item, action: 'pick' },
  );
  await runQuickPlan(store, base, plan.branch, plan.commits, steps, vi.rebase.rewordDone);
}

export async function dropCommit(store: RepoStore, commit: Commit): Promise<void> {
  const base = commit.parents[0];
  if (base === undefined || commit.parents.length !== 1) return;
  const plan = await rewritable(store, base, commit.id);
  if (plan === null) return;
  const confirmed = await dialogs.confirm({
    title: vi.rebase.dropTitle(shortSha(commit)),
    message: vi.rebase.dropMessage(commit.subject, plan.branch),
    confirmTitle: vi.rebase.dropConfirm,
    destructive: true,
  });
  if (!confirmed) return;
  const steps = plan.commits.map((item): RebaseStep => ({
    commit: item,
    action: item.id === commit.id ? 'drop' : 'pick',
  }));
  await runQuickPlan(store, base, plan.branch, plan.commits, steps, vi.rebase.dropDone);
}

/**
 * Đổi chỗ commit với commit liền sau (`up` — mới hơn) hoặc liền trước (`down` — cũ hơn) trên nhánh. Đưa xuống cần cha của
 * commit cũng là commit thường (để rebase từ ông của nó).
 */
export async function moveCommit(store: RepoStore, commit: Commit, direction: 'up' | 'down'): Promise<void> {
  const parent = commit.parents[0];
  if (parent === undefined || commit.parents.length !== 1) return;
  let base = parent;
  if (direction === 'down') {
    const parentCommit = store.entries.find((entry) => entry.commit.id === parent)?.commit;
    const grandparent = parentCommit?.parents.length === 1 ? parentCommit.parents[0] : undefined;
    if (grandparent === undefined) {
      store.notify('info', vi.rebase.alreadyOldest);
      return;
    }
    base = grandparent;
  }
  const plan = await rewritable(store, base, commit.id);
  if (plan === null) return;
  const steps = picks(plan.commits);
  const index = steps.findIndex((step) => step.commit.id === commit.id);
  const other = direction === 'up' ? index + 1 : index - 1;
  const moving = steps[index];
  const swapped = steps[other];
  if (moving === undefined || swapped === undefined) {
    store.notify('info', direction === 'up' ? vi.rebase.alreadyNewest : vi.rebase.alreadyOldest);
    return;
  }
  steps[index] = swapped;
  steps[other] = moving;
  await runQuickPlan(store, base, plan.branch, plan.commits, steps, vi.rebase.moveDone);
}
