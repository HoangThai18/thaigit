// Nhận diện lỗi git quen thuộc để hiện thông báo dễ hiểu kèm nút xử lý (port handleConflictError / handleCheckoutError của
// RepoModel+Actions.swift). Trả `true` khi đã tự hiện thông báo (dùng làm `onError` của `store.perform`).

import { GitError } from '@thaigit/core';
import { vi } from '../strings.vi.ts';
import type { RepoStore } from '../stores/repo.svelte.ts';
import type { ToastAction } from '../stores/toasts.svelte.ts';

export function gitErrorContains(error: unknown, ...needles: string[]): boolean {
  return error instanceof GitError && needles.some((needle) => error.contains(needle));
}

/** Thao tác dừng giữa chừng vì xung đột, hoặc bị chặn vì thay đổi chưa commit. */
export function handleConflictError(
  store: RepoStore,
  error: unknown,
  operation: string,
  stashChanges?: () => void,
): boolean {
  if (gitErrorContains(error, 'CONFLICT', 'Resolve all conflicts', 'could not apply')) {
    store.notify('warning', vi.remote.conflict(operation), { message: vi.remote.conflictMessage, tag: 'conflict' });
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

/** Lỗi mạng / đăng nhập của fetch, pull, push: thông báo gọn hơn đống stderr. */
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
    store.notify('warning', vi.remote.authFailed(operation), { message: vi.remote.authFailedMessage });
    return true;
  }
  if (gitErrorContains(error, 'Could not resolve host', 'Connection timed out', 'Connection refused', 'unable to access')) {
    store.showError(vi.remote.hostUnreachable(operation), error);
    return true;
  }
  return false;
}
