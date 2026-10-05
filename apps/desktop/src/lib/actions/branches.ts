// Switching / creating branches (a port of the Checkout and Branch parts of RepoModel+Actions.swift). There is an "Undo"
// (return to the old HEAD) and "Stash then switch" when uncommitted changes block the switch.

import {
  isValidRefName,
  refName,
  refRemoteName,
  refShortBranchName,
  type GitRef,
  type GitRepository,
  type HeadState,
} from '@thaigit/core';
import { vi } from '../strings.vi.ts';
import {
  dialogs as globalDialogs,
  flagValue,
  textValue,
  type DialogStore,
} from '../stores/dialogs.svelte.ts';
import { Scope, type RepoStore } from '../stores/repo.svelte.ts';
import { gitErrorContains, handleNetworkError } from './errors.ts';

type Work = (git: GitRepository) => Promise<void>;

export interface CheckoutRetry {
  title: string;
  work: Work;
  undo?: Work;
}

export function handleCheckoutError(
  store: RepoStore,
  error: unknown,
  retry: CheckoutRetry,
  dialogs?: DialogStore,
): boolean {
  if (!gitErrorContains(error, 'would be overwritten', 'Please commit your changes or stash them'))
    return false;
  if (gitErrorContains(error, 'untracked working tree files')) void askToSaveWork(store, retry, dialogs);
  else void carryThen(store, retry, dialogs);
  return true;
}

async function topStash(git: GitRepository): Promise<string | null> {
  return (await git.stashes())[0]?.sha ?? null;
}

async function carryThen(store: RepoStore, retry: CheckoutRetry, dialogs?: DialogStore): Promise<void> {
  let conflict = false;
  await store.perform(
    retry.title,
    async (git) => {
      const previous = store.status.head;
      const before = await topStash(git);
      await git.stashPush(vi.branches.autoStashMessage(retry.title), false);
      const stashed = (await topStash(git)) !== before;
      try {
        await retry.work(git);
      } catch (error) {
        if (stashed) await git.stashPop('stash@{0}').catch(() => undefined);
        throw error;
      }
      if (!stashed) return;
      try {
        await git.stashApply('stash@{0}');
        await git.stashDrop('stash@{0}');
      } catch {
        conflict = true;
        await git.reset('HEAD', 'hard');
        if (previous.kind === 'branch') await git.switchTo(previous.name);
        else if (previous.kind === 'detached') await git.switchDetached(previous.oid);
        await retry.undo?.(git);
        await git.stashPop('stash@{0}');
      }
    },
    {
      refresh: Scope.all,
      onSuccess: () => {
        if (conflict) void askToSaveWork(store, retry, dialogs);
        else store.notify('success', vi.branches.carriedChanges(retry.title));
      },
    },
  );
}

async function askToSaveWork(
  store: RepoStore,
  retry: CheckoutRetry,
  dialogs: DialogStore | undefined,
): Promise<void> {
  const answer = await (dialogs ?? globalDialogs).ask({
    title: vi.branches.dirtyTitle,
    message: vi.branches.dirtyMessage,
    confirmTitle: vi.branches.dirtyStash,
    secondaryTitle: vi.branches.dirtyCommit,
  });
  if (answer === 'confirm') void stashThen(store, retry);
  else if (answer === 'secondary') store.select({ kind: 'workingTree' });
}

export function stashThen(store: RepoStore, retry: CheckoutRetry): Promise<void> {
  return store.perform(
    retry.title,
    async (git) => {
      const before = await topStash(git);
      await git.stashPush(vi.branches.autoStashMessage(retry.title), true);
      const stashed = (await topStash(git)) !== before;
      try {
        await retry.work(git);
      } catch (error) {
        if (stashed) await git.stashPop('stash@{0}').catch(() => undefined);
        throw error;
      }
    },
    {
      refresh: Scope.all,
      onSuccess: () => store.notify('success', vi.branches.stashedAndDone(retry.title)),
    },
  );
}

/** Go back to the previous HEAD (a branch or a commit), then run `then` when given. */
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

/** Check out a ref: a local branch → switch to it; a remote branch → the same-named local branch (created when missing); a tag → detached HEAD. */
export function checkout(store: RepoStore, ref: GitRef, dialogs?: DialogStore): Promise<void> {
  switch (ref.kind) {
    case 'localBranch': {
      const name = refName(ref);
      if (name === store.currentBranch) {
        store.notify('info', vi.branches.alreadyOn(name));
        return Promise.resolve();
      }
      return switchToBranch(store, name, dialogs);
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
          handleCheckoutError(store, error, { title: vi.branches.checkoutTitle(remoteName), work }, dialogs),
      });
    }
    case 'tag':
      return checkoutDetached(store, ref.target, vi.branches.tagLabel(refName(ref)), dialogs);
  }
}

export function switchToBranch(store: RepoStore, name: string, dialogs?: DialogStore): Promise<void> {
  const previous = store.status.head;
  const work: Work = (git) => git.switchTo(name);
  return store.perform(vi.branches.checkoutTitle(name), work, {
    refresh: Scope.all,
    onSuccess: () =>
      store.notify('success', vi.branches.switched(name), {
        actions: [{ title: vi.staging.undo, run: () => void restoreHead(store, previous) }],
      }),
    onError: (error) =>
      handleCheckoutError(store, error, { title: vi.branches.checkoutTitle(name), work }, dialogs),
  });
}

/** Check out a commit (detached HEAD) — asks first, because newcomers are often confused by that state. */
export async function checkoutDetached(
  store: RepoStore,
  sha: string,
  label: string,
  dialogs?: DialogStore,
): Promise<void> {
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
      handleCheckoutError(store, error, { title: vi.branches.checkoutTitle(label), work }, dialogs),
  });
}

/** Ask for a name, then create the branch at `startPoint` (default HEAD), with an option to switch to it. */
export async function beginCreateBranch(
  store: RepoStore,
  startPoint?: { sha: string; label: string },
  dialogs?: DialogStore,
): Promise<void> {
  const head = store.headOid;
  const start =
    startPoint ?? (head === null ? null : { sha: head, label: store.currentBranch ?? head.slice(0, 7) });
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
      {
        kind: 'text',
        id: 'name',
        label: vi.branches.nameLabel,
        value: '',
        placeholder: 'feature/ten-nhanh',
        monospace: true,
      },
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
  await createBranch(store, textValue(values, 'name'), start.sha, flagValue(values, 'checkout'), dialogs);
}

export function createBranch(
  store: RepoStore,
  name: string,
  startPoint: string,
  checkoutAfter: boolean,
  dialogs?: DialogStore,
): Promise<void> {
  const previous = store.status.head;
  const work: Work = (git) => git.createBranch(name, startPoint, checkoutAfter);
  return store.perform(vi.branches.createTitleNamed(name), work, {
    refresh: Scope.all,
    onSuccess: () =>
      store.notify(
        'success',
        checkoutAfter ? vi.branches.createdAndSwitched(name) : vi.branches.created(name),
        {
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
        },
      ),
    onError: (error) =>
      handleCheckoutError(
        store,
        error,
        {
          title: vi.branches.createTitleNamed(name),
          work,
          undo: (git) => git.deleteBranch(name, true),
        },
        dialogs,
      ),
  });
}

// MARK: - Delete / rename / fast-forward

export async function deleteBranch(store: RepoStore, ref: GitRef, dialogs?: DialogStore): Promise<void> {
  const name = refName(ref);
  if (name === store.currentBranch) {
    store.notify('warning', vi.branches.cannotDeleteCurrent);
    return;
  }
  const confirmed = await (dialogs ?? globalDialogs).confirm({
    title: vi.branches.deleteConfirmTitle(name),
    message: vi.branches.deleteConfirmMessage,
    confirmTitle: vi.branches.deleteBranch,
    destructive: true,
  });
  if (confirmed) await performDeleteBranch(store, ref, false);
}

function performDeleteBranch(store: RepoStore, ref: GitRef, force: boolean): Promise<void> {
  const name = refName(ref);
  return store.perform(vi.branches.deleteTitle(name), (git) => git.deleteBranch(name, force), {
    refresh: Scope.refs | Scope.history,
    onSuccess: () =>
      store.notify('success', vi.branches.deleted(name), {
        actions: [
          {
            title: vi.staging.undo,
            run: () =>
              void store.perform(
                vi.branches.restoreBranch(name),
                (git) => git.updateRef(ref.fullName, ref.target),
                {
                  refresh: Scope.refs | Scope.history,
                  onSuccess: () => store.notify('success', vi.staging.undone),
                },
              ),
          },
        ],
      }),
    onError: (error) => {
      if (!gitErrorContains(error, 'not fully merged')) return false;
      store.showError(vi.branches.notMerged(name), error, [
        { title: vi.branches.deleteAnyway, run: () => void performDeleteBranch(store, ref, true) },
      ]);
      return true;
    },
  });
}

/** Delete a branch on the remote (visible to everyone — asks first). "Undo" pushes the exact old commit back. */
export async function deleteRemoteBranch(
  store: RepoStore,
  ref: GitRef,
  dialogs?: DialogStore,
): Promise<void> {
  const remotes = store.remotes.map((remote) => remote.name);
  const remote = refRemoteName(ref, remotes);
  if (remote === null) return;
  const branch = refShortBranchName(ref, remotes);
  const name = refName(ref);
  const confirmed = await (dialogs ?? globalDialogs).confirm({
    title: vi.branches.deleteRemoteConfirmTitle(name),
    message: vi.branches.deleteRemoteConfirmMessage(branch, remote),
    confirmTitle: vi.branches.deleteOnRemote,
    destructive: true,
  });
  if (!confirmed) return;
  const progress = store.progressReporter();
  await store.perform(
    vi.branches.deleteRemoteTitle(name),
    (git, signal) => git.deleteRemoteBranch(remote, branch, { onProgress: progress, signal }),
    {
      showsProgress: true,
      cancellable: true,
      refresh: Scope.refs | Scope.status | Scope.history,
      onSuccess: () =>
        store.notify('success', vi.branches.deletedRemote(name), {
          actions: [
            {
              title: vi.staging.undo,
              run: () => {
                const restoreProgress = store.progressReporter();
                void store.perform(
                  vi.branches.restoreRemote(name),
                  (git, signal) =>
                    git.pushCommit(ref.target, remote, branch, { onProgress: restoreProgress, signal }),
                  {
                    showsProgress: true,
                    cancellable: true,
                    refresh: Scope.refs | Scope.history,
                    onSuccess: () => store.notify('success', vi.staging.undone),
                    onError: (error) => handleNetworkError(store, error, vi.branches.restoreRemote(name)),
                  },
                );
              },
            },
          ],
        }),
      onError: (error) => handleNetworkError(store, error, vi.branches.deleteRemoteTitle(name)),
    },
  );
}

export async function beginRenameBranch(store: RepoStore, ref: GitRef, dialogs?: DialogStore): Promise<void> {
  const oldName = refName(ref);
  const existing = new Set(store.localBranches.map((candidate) => refName(candidate)));
  const values = await (dialogs ?? globalDialogs).form({
    title: vi.branches.renameTitle(oldName),
    confirmTitle: vi.branches.rename,
    fields: [{ kind: 'text', id: 'name', label: vi.branches.renameLabel, value: oldName, monospace: true }],
    validate: (current) => {
      const name = textValue(current, 'name');
      if (name === '') return vi.branches.nameRequired;
      if (!isValidRefName(name)) return vi.branches.nameInvalid;
      if (name !== oldName && existing.has(name)) return vi.branches.nameExists(name);
      return null;
    },
  });
  if (!values) return;
  const newName = textValue(values, 'name');
  if (newName === oldName) return;
  await store.perform(vi.branches.renameRunning, (git) => git.renameBranch(oldName, newName), {
    refresh: Scope.all,
    onSuccess: () =>
      store.notify('success', vi.branches.renamed(oldName, newName), {
        actions: [
          {
            title: vi.staging.undo,
            run: () =>
              void store.perform(vi.branches.renameRunning, (git) => git.renameBranch(newName, oldName), {
                refresh: Scope.all,
                onSuccess: () => store.notify('success', vi.staging.undone),
              }),
          },
        ],
      }),
  });
}

/** Bring a local branch level with its upstream (only when it is purely "behind"). */
export function fastForward(store: RepoStore, ref: GitRef): Promise<void> {
  const upstream = ref.upstream;
  if (upstream === null) return Promise.resolve();
  const name = refName(ref);
  return store.perform(
    vi.branches.fastForwardTitle(name),
    (git) =>
      name === store.currentBranch ? git.merge(upstream, 'fastForwardOnly') : git.fastForward(name, upstream),
    { refresh: Scope.all, onSuccess: () => store.notify('success', vi.branches.fastForwarded(name)) },
  );
}
