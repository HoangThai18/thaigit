// Recognises familiar git errors to show an understandable notification with a fix button (a port of handleConflictError / handleCheckoutError in
// RepoModel+Actions.swift). Returns `true` when it already showed a notification (used as `store.perform`'s `onError`).

import { GitError } from '@thaigit/core';
import { assignAccountForRepo } from '../forge/assignOwner.ts';
import { targetOf } from '../forge/pullRequests.ts';
import { vi } from '../strings.vi.ts';
import type { RepoStore } from '../stores/repo.svelte.ts';
import type { ToastAction } from '../stores/toasts.svelte.ts';

export function gitErrorContains(error: unknown, ...needles: string[]): boolean {
  return error instanceof GitError && needles.some((needle) => error.contains(needle));
}

/** An operation stopped halfway because of a conflict, or was blocked by uncommitted changes. */
export function handleConflictError(
  store: RepoStore,
  error: unknown,
  operation: string,
  stashChanges?: () => void,
): boolean {
  if (gitErrorContains(error, 'CONFLICT', 'Resolve all conflicts', 'could not apply')) {
    store.notify('warning', vi.remote.conflict(operation), {
      message: vi.remote.conflictMessage,
      tag: 'conflict',
    });
    store.select({ kind: 'workingTree' }, true);
    return true;
  }
  if (gitErrorContains(error, 'would be overwritten', 'Please commit your changes or stash them')) {
    const actions: ToastAction[] = stashChanges ? [{ title: vi.remote.stashChanges, run: stashChanges }] : [];
    store.showError(vi.remote.blockedByChanges(operation), error, actions);
    return true;
  }
  return false;
}

/** A network / sign-in error from fetch, pull or push: a shorter notification than the stderr dump. */
export function handleNetworkError(store: RepoStore, error: unknown, operation: string): boolean {
  if (
    gitErrorContains(
      error,
      'Authentication failed',
      'could not read Username',
      'could not read Password',
      'Permission denied (publickey',
      'returned error: 401',
      'returned error: 403',
      'terminal prompts disabled',
    )
  ) {
    // The remote is GitHub / GitLab / Bitbucket: suggest signing in (or picking the right account for the owner) right in the app.
    const actions: ToastAction[] =
      targetOf(store) === null
        ? []
        : [{ title: vi.accounts.openAccounts, run: () => void assignAccountForRepo(store) }];
    store.notify('warning', vi.remote.authFailed(operation), {
      message: vi.remote.authFailedMessage,
      actions,
    });
    return true;
  }
  if (
    gitErrorContains(
      error,
      'Could not resolve host',
      'Connection timed out',
      'Connection refused',
      'unable to access',
    )
  ) {
    store.showError(vi.remote.hostUnreachable(operation), error);
    return true;
  }
  return false;
}
