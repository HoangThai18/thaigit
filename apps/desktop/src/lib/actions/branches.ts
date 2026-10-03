// Đổi nhánh / tạo nhánh (port phần Checkout + Nhánh của RepoModel+Actions.swift). Có "Hoàn tác" (quay lại HEAD cũ) và
// "Stash rồi checkout" khi thay đổi chưa commit chặn việc đổi nhánh.

import { isValidRefName, refName, refShortBranchName, type GitRef, type GitRepository, type HeadState } from '@thaigit/core';
import { vi } from '../strings.vi.ts';
import { dialogs as globalDialogs, flagValue, textValue, type DialogStore } from '../stores/dialogs.svelte.ts';
import { Scope, type RepoStore } from '../stores/repo.svelte.ts';
import { gitErrorContains } from './errors.ts';
import { popLatestStash } from './stash.ts';

type Work = (git: GitRepository) => Promise<void>;

/** Thay đổi chưa commit chặn checkout: hiện lỗi kèm "Stash rồi checkout". */
export function handleCheckoutError(store: RepoStore, error: unknown, stashAndRetry: () => void): boolean {
  if (!gitErrorContains(error, 'would be overwritten', 'Please commit your changes or stash them')) return false;
  store.showError(vi.branches.checkoutBlocked, error, [{ title: vi.branches.stashAndCheckout, run: stashAndRetry }]);
  return true;
}

/** Cất thay đổi vào stash rồi chạy `work` (GitKraken gọi là auto-stash). */
export function stashThen(store: RepoStore, title: string, work: Work): Promise<void> {
  return store.perform(
    title,
    async (git) => {
      await git.stashPush(vi.branches.autoStashMessage(title), true);
      await work(git);
    },
    {
      refresh: Scope.all,
      onSuccess: () =>
        store.notify('success', vi.branches.doneWithStash(title), {
          actions: [{ title: vi.branches.popStash, run: () => void popLatestStash(store) }],
        }),
    },
  );
}

/** Quay lại HEAD trước đó (nhánh hoặc commit), rồi chạy thêm `then` nếu có. */
export function restoreHead(store: RepoStore, head: HeadState, then?: Work): Promise<void> {
  return store.perform(
    vi.branches.undoCheckout,
    async (git) => {
      if (head.kind === 'branch') await git.switchTo(head.name);
      else if (head.kind === 'detached') await git.switchDetached(head.oid);
      await then?.(git);
    },
    { refresh: Scope.all, onSuccess: () => store.notify('success', vi.staging.undone) },
  );
}

/** Checkout một ref: nhánh local → chuyển sang; nhánh remote → nhánh local cùng tên (tạo mới nếu chưa có); tag → HEAD tách rời. */
export function checkout(store: RepoStore, ref: GitRef, dialogs?: DialogStore): Promise<void> {
  switch (ref.kind) {
    case 'localBranch': {
      const name = refName(ref);
      if (name === store.currentBranch) {
        store.notify('info', vi.branches.alreadyOn(name));
        return Promise.resolve();
      }
      return switchToBranch(store, name);
    }
    case 'remoteBranch': {
      const remotes = store.remotes.map((remote) => remote.name);
      const localName = refShortBranchName(ref, remotes);
      const existing = store.localBranches.find((candidate) => refName(candidate) === localName);
      if (existing) return checkout(store, existing, dialogs);
      const remoteName = refName(ref);
      const previous = store.status.head;
      const work: Work = (git) => git.checkoutTracking(remoteName, localName);
      return store.perform(vi.branches.checkoutTitle(remoteName), work, {
        refresh: Scope.all,
        onSuccess: () =>
          store.notify('success', vi.branches.trackingCreated(localName, remoteName), {
            actions: [
              {
                title: vi.staging.undo,
                run: () => void restoreHead(store, previous, (git) => git.deleteBranch(localName, true)),
              },
            ],
          }),
        onError: (error) =>
          handleCheckoutError(store, error, () => void stashThen(store, vi.branches.checkoutTitle(remoteName), work)),
      });
    }
    case 'tag':
      return checkoutDetached(store, ref.target, vi.branches.tagLabel(refName(ref)), dialogs);
  }
}

export function switchToBranch(store: RepoStore, name: string): Promise<void> {
  const previous = store.status.head;
  const work: Work = (git) => git.switchTo(name);
  return store.perform(vi.branches.checkoutTitle(name), work, {
    refresh: Scope.all,
    onSuccess: () =>
      store.notify('success', vi.branches.switched(name), {
        actions: [{ title: vi.staging.undo, run: () => void restoreHead(store, previous) }],
      }),
    onError: (error) =>
      handleCheckoutError(store, error, () => void stashThen(store, vi.branches.checkoutTitle(name), work)),
  });
}

/** Checkout một commit (HEAD tách rời) — hỏi trước vì người mới hay lạc ở trạng thái này. */
export async function checkoutDetached(store: RepoStore, sha: string, label: string, dialogs?: DialogStore): Promise<void> {
  const confirmed = await (dialogs ?? globalDialogs).confirm({
    title: vi.branches.detachedConfirmTitle(label),
    message: vi.branches.detachedConfirmMessage,
    confirmTitle: vi.branches.checkout,
  });
  if (!confirmed) return;
  const previous = store.status.head;
  const work: Work = (git) => git.switchDetached(sha);
  await store.perform(vi.branches.checkoutTitle(label), work, {
    refresh: Scope.all,
    onSuccess: () =>
      store.notify('success', vi.branches.detached(label), {
        actions: [{ title: vi.staging.undo, run: () => void restoreHead(store, previous) }],
      }),
    onError: (error) =>
      handleCheckoutError(store, error, () => void stashThen(store, vi.branches.checkoutTitle(label), work)),
  });
}

/** Hỏi tên rồi tạo nhánh tại `startPoint` (mặc định HEAD), có tuỳ chọn chuyển sang luôn. */
export async function beginCreateBranch(
  store: RepoStore,
  startPoint?: { sha: string; label: string },
  dialogs?: DialogStore,
): Promise<void> {
  const head = store.headOid;
  const start = startPoint ?? (head === null ? null : { sha: head, label: store.currentBranch ?? head.slice(0, 7) });
  if (start === null) {
    store.notify('info', vi.branches.needCommitFirst);
    return;
  }
  const existing = new Set(store.localBranches.map((ref) => refName(ref)));
  const values = await (dialogs ?? globalDialogs).form({
    title: vi.branches.createTitle,
    message: vi.branches.createMessage(start.label),
    confirmTitle: vi.branches.create,
    fields: [
      { kind: 'text', id: 'name', label: vi.branches.nameLabel, value: '', placeholder: 'feature/ten-nhanh', monospace: true },
      { kind: 'checkbox', id: 'checkout', label: vi.branches.checkoutAfterCreate, value: true },
    ],
    validate: (current) => {
      const name = textValue(current, 'name');
      if (name === '') return vi.branches.nameRequired;
      if (!isValidRefName(name)) return vi.branches.nameInvalid;
      if (existing.has(name)) return vi.branches.nameExists(name);
      return null;
    },
  });
  if (!values) return;
  await createBranch(store, textValue(values, 'name'), start.sha, flagValue(values, 'checkout'));
}

export function createBranch(store: RepoStore, name: string, startPoint: string, checkoutAfter: boolean): Promise<void> {
  const previous = store.status.head;
  const work: Work = (git) => git.createBranch(name, startPoint, checkoutAfter);
  return store.perform(vi.branches.createTitleNamed(name), work, {
    refresh: Scope.all,
    onSuccess: () =>
      store.notify('success', checkoutAfter ? vi.branches.createdAndSwitched(name) : vi.branches.created(name), {
        actions: [
          {
            title: vi.staging.undo,
            run: () =>
              void (checkoutAfter
                ? restoreHead(store, previous, (git) => git.deleteBranch(name, true))
                : store.perform(vi.branches.deleteTitle(name), (git) => git.deleteBranch(name, true), {
                    refresh: Scope.all,
                    onSuccess: () => store.notify('success', vi.staging.undone),
                  })),
          },
        ],
      }),
    onError: (error) =>
      handleCheckoutError(store, error, () => void stashThen(store, vi.branches.createTitleNamed(name), work)),
  });
}
