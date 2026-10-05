// Remote management (sidebar → REMOTE, like GitKraken): add, fetch one remote, edit the address, rename, delete (with Undo).
// Addresses go through the typed commands (`remoteAdd` / `remoteSetUrl`) so Rust validates the URL — the webview never assembles a `remote add` command itself.

import { isValidRemoteName, type Remote } from '@thaigit/core';
import { vi } from '../strings.vi.ts';
import {
  dialogs as globalDialogs,
  flagValue,
  textValue,
  type DialogStore,
} from '../stores/dialogs.svelte.ts';
import { tidyMenu, type MenuItem } from '../stores/menus.svelte.ts';
import { Scope, type RepoStore } from '../stores/repo.svelte.ts';
import { handleNetworkError } from './errors.ts';

function validateName(name: string, taken: ReadonlySet<string>): string | null {
  if (name === '') return vi.remote.remoteNameRequired;
  if (!isValidRemoteName(name)) return vi.remote.remoteNameInvalid;
  if (taken.has(name)) return vi.remote.remoteExists(name);
  return null;
}

function remoteBranchCount(store: RepoStore, name: string): number {
  return store.remoteBranches.filter((ref) => ref.fullName.startsWith(`refs/remotes/${name}/`)).length;
}

/** A remote's context menu in the sidebar. */
export function remoteMenu(store: RepoStore, remote: Remote): MenuItem[] {
  return tidyMenu([
    {
      title: vi.remote.fetchRemote(remote.name),
      icon: 'fetch',
      run: () => void fetchRemote(store, remote.name),
    },
    { kind: 'separator' },
    { title: vi.remote.editRemoteUrl, icon: 'pencil', run: () => void beginEditRemoteUrl(store, remote) },
    { title: vi.remote.renameRemote, icon: 'pencil', run: () => void beginRenameRemote(store, remote) },
    remote.fetchUrl !== '' && {
      title: vi.remote.copyRemoteUrl,
      icon: 'copy',
      run: () => void store.copy(remote.fetchUrl, vi.remote.remoteUrlCopyLabel),
    },
    { kind: 'separator' },
    {
      title: vi.remote.removeRemote,
      icon: 'trash',
      destructive: true,
      run: () => void removeRemote(store, remote),
    },
  ]);
}

export async function beginAddRemote(store: RepoStore, dialogs?: DialogStore): Promise<void> {
  const taken = new Set(store.remotes.map((remote) => remote.name));
  const values = await (dialogs ?? globalDialogs).form({
    title: vi.remote.addRemoteTitle,
    message: vi.remote.addRemoteMessage,
    confirmTitle: vi.remote.addRemoteTitle,
    fields: [
      {
        kind: 'text',
        id: 'name',
        label: vi.remote.remoteNameLabel,
        value: taken.has('origin') ? '' : 'origin',
        placeholder: 'upstream',
        monospace: true,
      },
      {
        kind: 'text',
        id: 'url',
        label: vi.remote.remoteUrlLabel,
        value: '',
        placeholder: 'https://github.com/owner/repo.git',
        monospace: true,
      },
      { kind: 'checkbox', id: 'fetch', label: vi.remote.fetchAfterAdd, value: true },
    ],
    validate: (current) =>
      validateName(textValue(current, 'name'), taken) ??
      (textValue(current, 'url') === '' ? vi.remote.remoteUrlRequired : null),
  });
  if (!values) return;
  await addRemote(store, textValue(values, 'name'), textValue(values, 'url'), flagValue(values, 'fetch'));
}

export async function addRemote(
  store: RepoStore,
  name: string,
  url: string,
  fetchAfter: boolean,
): Promise<void> {
  let added = false;
  await store.perform(vi.remote.addRemoteRunning(name), (git) => git.addRemote(name, url), {
    refresh: Scope.refs,
    onSuccess: () => {
      added = true;
      if (!fetchAfter) store.notify('success', vi.remote.remoteAdded(name));
    },
  });
  if (added && fetchAfter) await fetchRemote(store, name);
}

/** Fetch a single remote (from the remote's sidebar menu). */
export function fetchRemote(store: RepoStore, name: string): Promise<void> {
  const progress = store.progressReporter();
  const prune = store.preferences.fetchPrune;
  return store.perform(
    vi.remote.fetchRemote(name),
    (git, signal) => git.fetch({ remote: name, prune, onProgress: progress, signal }),
    {
      showsProgress: true,
      cancellable: true,
      refresh: Scope.refs | Scope.status,
      onSuccess: () => store.notify('success', vi.remote.remoteFetched(name)),
      onError: (error) => handleNetworkError(store, error, vi.remote.fetchRemote(name)),
    },
  );
}

export async function beginEditRemoteUrl(
  store: RepoStore,
  remote: Remote,
  dialogs?: DialogStore,
): Promise<void> {
  const values = await (dialogs ?? globalDialogs).form({
    title: vi.remote.editRemoteUrlTitle(remote.name),
    confirmTitle: vi.remote.saveRemoteUrl,
    fields: [
      { kind: 'text', id: 'url', label: vi.remote.remoteUrlLabel, value: remote.fetchUrl, monospace: true },
    ],
    validate: (current) => (textValue(current, 'url') === '' ? vi.remote.remoteUrlRequired : null),
  });
  if (!values) return;
  const url = textValue(values, 'url');
  if (url === remote.fetchUrl && url === remote.pushUrl) return;
  await store.perform(
    vi.remote.editRemoteUrlRunning(remote.name),
    (git) => git.setRemoteUrl(remote.name, url),
    {
      refresh: Scope.refs,
      onSuccess: () => store.notify('success', vi.remote.remoteUrlChanged(remote.name)),
    },
  );
}

export async function beginRenameRemote(
  store: RepoStore,
  remote: Remote,
  dialogs?: DialogStore,
): Promise<void> {
  const taken = new Set(store.remotes.map((item) => item.name));
  const values = await (dialogs ?? globalDialogs).form({
    title: vi.remote.renameRemoteTitle(remote.name),
    message: vi.remote.renameRemoteMessage,
    confirmTitle: vi.remote.renameRemoteConfirm,
    fields: [
      { kind: 'text', id: 'name', label: vi.remote.remoteNameLabel, value: remote.name, monospace: true },
    ],
    validate: (current) => {
      const name = textValue(current, 'name');
      return name === remote.name ? null : validateName(name, taken);
    },
  });
  if (!values) return;
  const name = textValue(values, 'name');
  if (name === remote.name) return;
  await store.perform(
    vi.remote.renameRemoteRunning(remote.name),
    (git) => git.renameRemote(remote.name, name),
    {
      refresh: Scope.all,
      onSuccess: () => store.notify('success', vi.remote.remoteRenamed(remote.name, name)),
    },
  );
}

/** Delete a remote (asks first). Undo adds the remote back with the same address; its branches return after the next fetch. */
export async function removeRemote(store: RepoStore, remote: Remote, dialogs?: DialogStore): Promise<void> {
  const confirmed = await (dialogs ?? globalDialogs).confirm({
    title: vi.remote.removeRemoteTitle(remote.name),
    message: vi.remote.removeRemoteMessage(remoteBranchCount(store, remote.name)),
    confirmTitle: vi.remote.removeRemoteConfirm,
    destructive: true,
  });
  if (!confirmed) return;
  await store.perform(vi.remote.removeRemoteRunning(remote.name), (git) => git.removeRemote(remote.name), {
    refresh: Scope.all,
    onSuccess: () =>
      store.notify('success', vi.remote.remoteRemoved(remote.name), {
        actions:
          remote.fetchUrl === ''
            ? []
            : [{ title: vi.remote.undoRemoveRemote, run: () => void restoreRemote(store, remote) }],
      }),
  });
}

async function restoreRemote(store: RepoStore, remote: Remote): Promise<void> {
  // Only the fetch address is restored (for most remotes that is also the push address): `set-url --push` is a typed command not yet exposed to the webview.
  await store.perform(
    vi.remote.addRemoteRunning(remote.name),
    (git) => git.addRemote(remote.name, remote.fetchUrl),
    {
      refresh: Scope.refs,
      onSuccess: () => store.notify('success', vi.remote.remoteRestored(remote.name)),
    },
  );
}
