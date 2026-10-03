// Stash nhanh / pop / apply / xoá stash (port phần Stash của RepoModel+Actions.swift). Mọi thao tác có "Hoàn tác" khi làm được.

import { isStatusClean, stashDisplayMessage, type Stash } from '@thaigit/core';
import { vi } from '../strings.vi.ts';
import { dialogs as globalDialogs, flagValue, textValue, type DialogStore } from '../stores/dialogs.svelte.ts';
import { Scope, type RepoStore } from '../stores/repo.svelte.ts';
import { handleConflictError } from './errors.ts';

/** Cất mọi thay đổi (kể cả file mới) vào stash, không hỏi tên. */
export function quickStash(store: RepoStore): Promise<void> {
  if (isStatusClean(store.status)) {
    store.notify('info', vi.branches.nothingToStash);
    return Promise.resolve();
  }
  return stash(store, '', true);
}

/** Hỏi lời nhắn (+ có gồm file mới không) rồi stash. */
export async function beginStash(store: RepoStore, dialogs?: DialogStore): Promise<void> {
  if (isStatusClean(store.status)) {
    store.notify('info', vi.branches.nothingToStash);
    return;
  }
  const values = await (dialogs ?? globalDialogs).form({
    title: vi.branches.stashMessageTitle,
    confirmTitle: vi.branches.stashTitle,
    fields: [
      { kind: 'text', id: 'message', label: vi.branches.stashMessageLabel, value: '' },
      { kind: 'checkbox', id: 'untracked', label: vi.branches.stashIncludeUntracked, value: true },
    ],
  });
  if (!values) return;
  await stash(store, textValue(values, 'message'), flagValue(values, 'untracked'));
}

export function stash(store: RepoStore, message: string, includeUntracked: boolean): Promise<void> {
  return store.perform(vi.branches.stashTitle, (git) => git.stashPush(message === '' ? null : message, includeUntracked), {
    refresh: Scope.all,
    onSuccess: () =>
      store.notify('success', vi.branches.stashed, {
        actions: [{ title: vi.staging.undo, run: () => void popLatestStash(store) }],
      }),
  });
}

export function popLatestStash(store: RepoStore): Promise<void> {
  const latest = store.stashes[0];
  if (!latest) {
    store.notify('info', vi.branches.noStash);
    return Promise.resolve();
  }
  return popStash(store, latest);
}

export function popStash(store: RepoStore, entry: Stash): Promise<void> {
  return store.perform(vi.branches.popTitle, (git) => git.stashPop(entry.selector), {
    refresh: Scope.all,
    onSuccess: () => store.notify('success', vi.branches.popped),
    onError: (error) => {
      if (handleConflictError(store, error, vi.branches.popTitle)) {
        store.notify('info', vi.branches.stashKept);
        return true;
      }
      return false;
    },
  });
}

export function applyStash(store: RepoStore, entry: Stash): Promise<void> {
  return store.perform(vi.branches.applyStashTitle, (git) => git.stashApply(entry.selector), {
    refresh: Scope.all,
    onSuccess: () => store.notify('success', vi.branches.stashApplied(stashDisplayMessage(entry))),
    onError: (error) => handleConflictError(store, error, vi.branches.applyStashTitle),
  });
}

export async function dropStash(store: RepoStore, entry: Stash, options: { dialogs?: DialogStore } = {}): Promise<void> {
  const label = stashDisplayMessage(entry);
  const confirmed = await (options.dialogs ?? globalDialogs).confirm({
    title: vi.branches.dropStashConfirmTitle(label),
    message: vi.branches.undoHint,
    confirmTitle: vi.branches.dropStash,
    destructive: true,
  });
  if (!confirmed) return;
  await store.perform(vi.branches.dropStash, (git) => git.stashDrop(entry.selector), {
    refresh: Scope.all,
    onSuccess: () =>
      store.notify('success', vi.branches.stashDropped, {
        actions: [
          {
            title: vi.staging.undo,
            run: () =>
              void store.perform(vi.branches.restoreStash, (git) => git.stashStore(entry.sha, entry.message), {
                refresh: Scope.all,
                onSuccess: () => store.notify('success', vi.staging.undone),
              }),
          },
        ],
      }),
  });
}
