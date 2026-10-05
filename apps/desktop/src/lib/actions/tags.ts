// Creating / deleting / pushing tags (a port of the Tag part of RepoModel+Actions.swift).

import { isValidRefName, refName, type GitRef } from '@thaigit/core';
import { vi } from '../strings.vi.ts';
import {
  dialogs as globalDialogs,
  flagValue,
  textValue,
  type DialogStore,
} from '../stores/dialogs.svelte.ts';
import { Scope, type RepoStore } from '../stores/repo.svelte.ts';
import { handleNetworkError } from './errors.ts';

/** Ask for a name (+ a message, + push right away), then create the tag at `sha`. */
export async function beginCreateTag(
  store: RepoStore,
  sha: string,
  label: string,
  dialogs?: DialogStore,
): Promise<void> {
  const existing = new Set(store.tags.map((ref) => refName(ref)));
  const remote = store.defaultRemote;
  const values = await (dialogs ?? globalDialogs).form({
    title: vi.branches.createTagTitle,
    message: vi.branches.createTagMessage(label),
    confirmTitle: vi.branches.createTag,
    fields: [
      {
        kind: 'text',
        id: 'name',
        label: vi.branches.tagNameLabel,
        value: '',
        placeholder: 'v1.0.0',
        monospace: true,
      },
      { kind: 'text', id: 'message', label: vi.branches.tagMessageLabel, value: '' },
      ...(remote === null
        ? []
        : [
            {
              kind: 'checkbox' as const,
              id: 'push',
              label: vi.branches.tagPushToRemote(remote),
              value: false,
            },
          ]),
    ],
    validate: (current) => {
      const name = textValue(current, 'name');
      if (name === '') return vi.branches.tagNameRequired;
      if (!isValidRefName(name, false)) return vi.branches.tagNameInvalid;
      if (existing.has(name)) return vi.branches.tagExists(name);
      return null;
    },
  });
  if (!values) return;
  await createTag(
    store,
    textValue(values, 'name'),
    sha,
    textValue(values, 'message'),
    flagValue(values, 'push') ? remote : null,
  );
}

export function createTag(
  store: RepoStore,
  name: string,
  sha: string,
  message: string,
  pushTo: string | null,
): Promise<void> {
  const progress = store.progressReporter();
  return store.perform(
    vi.branches.createTagRunning(name),
    async (git, signal) => {
      await git.createTag(name, sha, message === '' ? null : message);
      if (pushTo !== null) await git.pushTag(pushTo, name, { onProgress: progress, signal });
    },
    {
      showsProgress: pushTo !== null,
      cancellable: pushTo !== null,
      refresh: Scope.refs | Scope.history,
      onSuccess: () =>
        store.notify(
          'success',
          pushTo !== null ? vi.branches.tagCreatedPushed(name) : vi.branches.tagCreated(name),
          {
            actions:
              pushTo !== null
                ? []
                : [
                    {
                      title: vi.staging.undo,
                      run: () =>
                        void store.perform(vi.branches.deleteTagRunning(name), (git) => git.deleteTag(name), {
                          refresh: Scope.refs | Scope.history,
                          onSuccess: () => store.notify('success', vi.staging.undone),
                        }),
                    },
                  ],
          },
        ),
      onError: (error) => handleNetworkError(store, error, vi.branches.pushTagRunning(name)),
    },
  );
}

export async function deleteTag(store: RepoStore, ref: GitRef, dialogs?: DialogStore): Promise<void> {
  const name = refName(ref);
  const confirmed = await (dialogs ?? globalDialogs).confirm({
    title: vi.branches.deleteTagConfirmTitle(name),
    message: vi.branches.deleteTagConfirmMessage,
    confirmTitle: vi.branches.deleteTag,
    destructive: true,
  });
  if (!confirmed) return;
  await store.perform(vi.branches.deleteTagRunning(name), (git) => git.deleteTag(name), {
    refresh: Scope.refs | Scope.history,
    onSuccess: () =>
      store.notify('success', vi.branches.tagDeleted(name), {
        actions: [
          {
            title: vi.staging.undo,
            run: () =>
              void store.perform(
                vi.branches.restoreTag,
                (git) => git.updateRef(ref.fullName, ref.objectName),
                {
                  refresh: Scope.refs | Scope.history,
                  onSuccess: () => store.notify('success', vi.staging.undone),
                },
              ),
          },
        ],
      }),
  });
}

/** Push a tag to `remote` (default: the repo's main remote). */
export function pushTag(
  store: RepoStore,
  ref: GitRef,
  remote: string | null = store.defaultRemote,
): Promise<void> {
  if (remote === null) {
    store.notify('info', vi.remote.noRemote);
    return Promise.resolve();
  }
  const name = refName(ref);
  const progress = store.progressReporter();
  return store.perform(
    vi.branches.pushTagRunning(name),
    (git, signal) => git.pushTag(remote, name, { onProgress: progress, signal }),
    {
      showsProgress: true,
      cancellable: true,
      refresh: Scope.refs,
      onSuccess: () => store.notify('success', vi.branches.tagPushed(name, remote)),
      onError: (error) => handleNetworkError(store, error, vi.branches.pushTagRunning(name)),
    },
  );
}

export async function deleteRemoteTag(store: RepoStore, ref: GitRef, dialogs?: DialogStore): Promise<void> {
  const remote = store.defaultRemote;
  if (remote === null) return;
  const name = refName(ref);
  const confirmed = await (dialogs ?? globalDialogs).confirm({
    title: vi.branches.deleteRemoteTagConfirmTitle(name, remote),
    message: vi.branches.deleteRemoteTagConfirmMessage,
    confirmTitle: vi.branches.deleteOnRemote,
    destructive: true,
  });
  if (!confirmed) return;
  const progress = store.progressReporter();
  await store.perform(
    vi.branches.deleteRemoteTagRunning,
    (git, signal) => git.deleteRemoteTag(remote, name, { onProgress: progress, signal }),
    {
      showsProgress: true,
      cancellable: true,
      refresh: Scope.refs,
      onSuccess: () => store.notify('success', vi.branches.remoteTagDeleted(name, remote)),
      onError: (error) => handleNetworkError(store, error, vi.branches.deleteRemoteTagRunning),
    },
  );
}
