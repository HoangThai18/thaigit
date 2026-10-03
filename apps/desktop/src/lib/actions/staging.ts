// Stage / bỏ stage / huỷ thay đổi — theo file, hunk hoặc từng dòng (port phần stage của RepoModel+Actions.swift).
// Mọi thao tác ghi đi qua `store.perform` (hàng đợi tuần tự, tự làm mới). Huỷ thay đổi luôn hỏi trước và có "Hoàn tác":
// file đã track được chụp lại bằng `stash create` (commit lơ lửng) rồi khôi phục bằng `restore --source`; file mới được dời
// vào thùng rác của app rồi trả lại.

import {
  fileChangeAllPaths,
  fileChangeName,
  makePatch,
  selectionForWholeHunk,
  type FileChange,
  type FileDiff,
} from '@thaigit/core';
import { vi } from '../strings.vi.ts';
import { dialogs, type DialogStore } from '../stores/dialogs.svelte.ts';
import type { LineSelection } from '../stores/diff.svelte.ts';
import { Scope, type RepoStore } from '../stores/repo.svelte.ts';

export type PatchAction = 'stage' | 'unstage' | 'discard';

function allPaths(changes: readonly FileChange[]): string[] {
  return changes.flatMap((change) => fileChangeAllPaths(change));
}

export function stageFiles(store: RepoStore, changes: readonly FileChange[]): Promise<void> {
  if (changes.length === 0) return Promise.resolve();
  return store.perform(vi.staging.stageTitle(changes.length), (git) => git.stage(allPaths(changes)), {
    refresh: Scope.status,
  });
}

export function unstageFiles(store: RepoStore, changes: readonly FileChange[]): Promise<void> {
  if (changes.length === 0) return Promise.resolve();
  const headExists = store.headOid !== null;
  return store.perform(
    vi.staging.unstageTitle(changes.length),
    (git) => git.unstage(allPaths(changes), headExists),
    {
      refresh: Scope.status,
    },
  );
}

export function stageAll(store: RepoStore): Promise<void> {
  return store.perform(vi.staging.stageAllTitle, (git) => git.stageAll(), { refresh: Scope.status });
}

export function unstageAll(store: RepoStore): Promise<void> {
  const headExists = store.headOid !== null;
  return store.perform(vi.staging.unstageAllTitle, (git) => git.unstageAll(headExists), {
    refresh: Scope.status,
  });
}

/**
 * Huỷ mọi thay đổi chưa stage của các file (hỏi trước). File đã track: khôi phục từ index; file mới: dời vào thùng rác của
 * app. Xong hiện "Hoàn tác".
 */
export async function discardFiles(
  store: RepoStore,
  changes: readonly FileChange[],
  options: { dialogs?: DialogStore } = {},
): Promise<void> {
  if (changes.length === 0) return;
  const ask = options.dialogs ?? dialogs;
  const first = changes[0];
  const name = first ? fileChangeName(first) : '';
  const confirmed = await ask.confirm({
    title: vi.staging.discardConfirmTitle(changes.length, name),
    message: vi.staging.discardConfirmMessage,
    confirmTitle: vi.staging.discardConfirm,
    destructive: true,
  });
  if (!confirmed) return;

  const untracked = changes.filter((change) => change.kind === 'untracked').map((change) => change.path);
  const tracked = allPaths(changes.filter((change) => change.kind !== 'untracked'));
  let snapshot: string | null = null;
  let trashToken: string | null = null;
  await store.perform(
    vi.staging.discardTitle,
    async (git) => {
      if (tracked.length > 0) {
        snapshot = await git.snapshotChanges();
        await git.discard(tracked);
      }
      if (untracked.length > 0) trashToken = await git.trashUntracked(untracked);
    },
    {
      refresh: Scope.status,
      onSuccess: () => {
        const restoreSnapshot = snapshot;
        const restoreToken = trashToken;
        store.notify('success', vi.staging.discarded(changes.length), {
          actions: [
            {
              title: vi.staging.undo,
              run: () =>
                void store.perform(
                  vi.staging.undoTitle,
                  async (git) => {
                    if (restoreSnapshot !== null) await git.restoreWorkingFiles(restoreSnapshot, tracked);
                    if (restoreToken !== null) await git.restoreTrash(restoreToken);
                  },
                  { refresh: Scope.status, onSuccess: () => store.notify('success', vi.staging.undone) },
                ),
            },
          ],
        });
      },
    },
  );
}

/**
 * Patch cho `action` từ diff đang xem: `hunkId` cho cả một hunk, không thì các dòng đang chọn. `null` khi không có gì để áp
 * (không chọn dòng nào, hoặc file không hỗ trợ stage từng phần).
 */
export function buildPatch(
  diff: FileDiff,
  action: PatchAction,
  selection: LineSelection,
  hunkId?: number,
): Uint8Array | null {
  let chosen: LineSelection = selection;
  if (hunkId !== undefined) {
    const hunk = diff.hunks.find((candidate) => candidate.id === hunkId);
    if (!hunk) return null;
    chosen = selectionForWholeHunk(hunk);
  }
  // Stage: diff index→worktree áp xuôi vào index. Bỏ stage: diff HEAD→index áp ngược vào index. Huỷ: diff index→worktree
  // áp ngược vào worktree.
  return makePatch(diff, chosen, action !== 'stage');
}

/**
 * Stage / bỏ stage / huỷ một hunk (`hunkId`) hoặc các dòng đang chọn của file đang xem. Huỷ thì hỏi trước và chụp lại file
 * để "Hoàn tác".
 */
export async function applyToSelection(
  store: RepoStore,
  action: PatchAction,
  options: { hunkId?: number; dialogs?: DialogStore } = {},
): Promise<void> {
  const file = store.diff.file;
  const diff = store.diff.fileDiff;
  if (!file || !diff) return;
  if (!store.diff.supportsPartial) {
    store.notify('info', vi.staging.partialUnsupported);
    return;
  }
  const patch = buildPatch(diff, action, store.diff.selection, options.hunkId);
  if (!patch) return;

  if (action === 'discard') {
    const confirmed = await (options.dialogs ?? dialogs).confirm({
      title: vi.staging.discardHunkConfirmTitle,
      message: vi.staging.discardHunkConfirmMessage,
      confirmTitle: vi.staging.discardConfirm,
      destructive: true,
    });
    if (!confirmed) return;
  }

  const paths = fileChangeAllPaths(file.change);
  let snapshot: string | null = null;
  const title =
    options.hunkId !== undefined
      ? { stage: vi.staging.stageHunk, unstage: vi.staging.unstageHunk, discard: vi.staging.discardHunk }[
          action
        ]
      : { stage: vi.staging.stageLines, unstage: vi.staging.unstageLines, discard: vi.staging.discardLines }[
          action
        ];
  await store.perform(
    title,
    async (git) => {
      if (action === 'discard') snapshot = await git.snapshotChanges();
      await git.applyPatch(patch, { cached: action !== 'discard', reverse: action !== 'stage' });
    },
    {
      refresh: Scope.status,
      onSuccess: () => {
        store.diff.clearSelection();
        const restore = snapshot;
        if (action !== 'discard' || restore === null) return;
        store.notify('success', vi.staging.discarded(1), {
          actions: [
            {
              title: vi.staging.undo,
              run: () =>
                void store.perform(vi.staging.undoTitle, (git) => git.restoreWorkingFiles(restore, paths), {
                  refresh: Scope.status,
                  onSuccess: () => store.notify('success', vi.staging.undone),
                }),
            },
          ],
        });
      },
    },
  );
}
