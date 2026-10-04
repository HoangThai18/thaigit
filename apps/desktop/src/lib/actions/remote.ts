// Fetch / pull / push (port phần Remote của RepoModel+Actions.swift). Thao tác mạng hiện thanh bận có tiến độ và nút Huỷ;
// lỗi quen thuộc (bị từ chối, tách nhánh, xung đột, đăng nhập) thành thông báo dễ hiểu kèm nút xử lý.

import { isValidRefName, refName, type GitRef, type PullMode } from '@thaigit/core';
import { friendlyError } from '../errors/friendly.ts';
import { vi } from '../strings.vi.ts';
import { dialogs as globalDialogs, textValue, type DialogStore } from '../stores/dialogs.svelte.ts';
import type { PullModePref } from '../stores/prefs.svelte.ts';
import { Scope, type RepoStore } from '../stores/repo.svelte.ts';
import { gitErrorContains, handleConflictError, handleNetworkError } from './errors.ts';
import { beginAddRemote } from './manageRemotes.ts';
import { quickStash } from './stash.ts';

export interface PushRequest {
  readonly localBranch: string;
  readonly remote: string;
  readonly remoteBranch: string;
  readonly setUpstream: boolean;
  readonly force: boolean;
}

export function pullModeFromPref(pref: PullModePref): PullMode {
  return pref === 'ff-only' ? 'fastForwardOnly' : pref;
}

function noRemote(store: RepoStore): boolean {
  if (store.remotes.length > 0) return false;
  store.notify('info', vi.remote.noRemote, {
    actions: [{ title: vi.remote.addRemote, run: () => void beginAddRemote(store) }],
  });
  return true;
}

export function fetch(store: RepoStore): Promise<void> {
  if (noRemote(store)) return Promise.resolve();
  const progress = store.progressReporter();
  const prune = store.preferences.fetchPrune;
  return store.perform(vi.remote.fetch, (git, signal) => git.fetch({ prune, onProgress: progress, signal }), {
    showsProgress: true,
    cancellable: true,
    refresh: Scope.refs | Scope.status,
    onSuccess: () => {
      store.lastFetch = Date.now();
      store.notify('success', vi.remote.fetched);
    },
    onError: (error) => handleNetworkError(store, error, vi.remote.fetch),
  });
}

/**
 * "Lấy đầy đủ từ remote" (thanh báo khi repo thiếu nhánh / lịch sử): remote chỉ theo dõi vài nhánh thì thêm refspec mọi
 * nhánh (giữ refspec cũ), clone nông thì lấy nốt commit cũ, rồi fetch để các nhánh như `main` hiện ra.
 */
export function completeHistory(store: RepoStore): Promise<void> {
  if (noRemote(store)) return Promise.resolve();
  const { shallow, narrowRemotes } = store.historyGaps;
  const source = store.defaultRemote;
  const progress = store.progressReporter();
  const prune = store.preferences.fetchPrune;
  return store.perform(
    vi.remote.completeHistory,
    async (git, signal) => {
      for (const remote of narrowRemotes) await git.trackAllBranches(remote);
      if (shallow && source !== null) await git.unshallow(source, { onProgress: progress, signal });
      await git.fetch({ prune, onProgress: progress, signal });
    },
    {
      showsProgress: true,
      cancellable: true,
      refresh: Scope.all,
      onSuccess: () => {
        store.lastFetch = Date.now();
        store.notify('success', vi.remote.historyCompleted);
      },
      onError: (error) => handleNetworkError(store, error, vi.remote.completeHistory),
    },
  );
}

/**
 * Tự fetch nền (theo cài đặt): không thanh bận, không hộp đăng nhập (profile `background`), lỗi chỉ hiện MỘT cảnh báo
 * (tag cố định, lần sau thay lần trước) để mất mạng lâu không chồng thông báo.
 */
export function backgroundFetch(store: RepoStore): Promise<void> {
  if (store.remotes.length === 0 || store.busy !== null) return Promise.resolve();
  const prune = store.preferences.fetchPrune;
  return store.perform(
    vi.remote.fetch,
    (git, signal) => git.fetch({ prune, signal, profile: 'background' }),
    {
      refresh: Scope.refs | Scope.status,
      onSuccess: () => {
        store.lastFetch = Date.now();
      },
      onError: (error) => {
        store.notify('warning', vi.remote.autoFetchFailed, {
          message: friendlyError(error),
          tag: 'auto-fetch',
        });
        return true;
      },
    },
  );
}

/** Pull nhánh hiện tại. Trả `true` khi pull xong không lỗi (để "Pull rồi Push" biết có push tiếp được không). */
export async function pull(store: RepoStore, mode?: PullMode): Promise<boolean> {
  const branch = store.currentBranchRef;
  if (!branch) {
    store.notify('warning', vi.remote.needBranchToPull);
    return false;
  }
  const name = branch.fullName.slice('refs/heads/'.length);
  if (branch.upstream === null || branch.upstreamGone) {
    store.notify('warning', vi.remote.noUpstream(name), {
      actions: [{ title: vi.remote.pushToRemote, run: () => void push(store) }],
    });
    return false;
  }
  const chosen = mode ?? pullModeFromPref(store.preferences.pullMode);
  const previousHead = store.headOid;
  let newHead: string | null = null;
  let pulled = false;
  const progress = store.progressReporter();
  await store.perform(
    vi.remote.pull,
    async (git, signal) => {
      await git.pull(chosen, { onProgress: progress, signal });
      newHead = await git.resolveCommit('HEAD').catch(() => null);
    },
    {
      showsProgress: true,
      cancellable: true,
      refresh: Scope.all,
      onSuccess: () => {
        pulled = true;
        store.lastFetch = Date.now();
        if (previousHead !== null && newHead !== null && newHead !== previousHead) {
          const restore = previousHead;
          store.notify('success', vi.remote.pulled(name), {
            actions: [
              {
                title: vi.staging.undo,
                run: () =>
                  void store.perform(vi.remote.undoPull, (git) => git.resetKeepingLocalChanges(restore), {
                    refresh: Scope.all,
                    onSuccess: () => store.notify('success', vi.staging.undone),
                  }),
              },
            ],
          });
        } else {
          store.notify('success', vi.remote.upToDate(name));
        }
      },
      onError: (error) => {
        if (handleNetworkError(store, error, vi.remote.pull)) return true;
        if (gitErrorContains(error, 'Not possible to fast-forward', 'divergent')) {
          store.showError(vi.remote.diverged, error, [
            { title: vi.remote.pullWithMerge, run: () => void pull(store, 'merge') },
            { title: vi.remote.pullWithRebase, run: () => void pull(store, 'rebase') },
          ]);
          return true;
        }
        return handleConflictError(store, error, vi.remote.pull, () => void quickStash(store));
      },
    },
  );
  return pulled;
}

/**
 * Đồng bộ nhánh hiện tại: pull (kiểu trong cài đặt) rồi push nếu pull không lỗi — dùng cho "Pull rồi Push" khi push bị từ
 * chối và mục "Đồng bộ" ở menu Pull. Chưa có upstream thì chỉ push (đặt upstream).
 */
export async function sync(store: RepoStore, dialogs?: DialogStore): Promise<void> {
  const branch = store.currentBranchRef;
  if (branch && (branch.upstream === null || branch.upstreamGone)) {
    await push(store, { dialogs });
    return;
  }
  if (await pull(store)) await push(store, { dialogs });
}

/** Push nhánh hiện tại (xem `pushBranch`). */
export function push(
  store: RepoStore,
  options: { force?: boolean; dialogs?: DialogStore } = {},
): Promise<void> {
  const branch = store.currentBranchRef;
  if (!branch) {
    store.notify('warning', vi.remote.needBranchToPush);
    return Promise.resolve();
  }
  return pushBranch(store, branch, options);
}

/** Push một nhánh local: có upstream thì đẩy lên đó, chưa có thì hỏi remote + tên nhánh rồi đặt upstream. */
export async function pushBranch(
  store: RepoStore,
  branch: GitRef,
  options: { force?: boolean; dialogs?: DialogStore } = {},
): Promise<void> {
  if (noRemote(store)) return;
  const name = refName(branch);
  const target =
    branch.upstream !== null && !branch.upstreamGone ? store.splitUpstream(branch.upstream) : null;
  if (target) {
    await performPush(
      store,
      {
        localBranch: name,
        remote: target.remote,
        remoteBranch: target.branch,
        setUpstream: false,
        force: options.force === true,
      },
      options.dialogs,
    );
    return;
  }
  const values = await (options.dialogs ?? globalDialogs).form({
    title: vi.remote.publishTitle(name),
    message: vi.remote.publishMessage,
    confirmTitle: vi.remote.publishConfirm,
    fields: [
      {
        kind: 'select',
        id: 'remote',
        label: vi.remote.publishRemote,
        value: store.defaultRemote ?? store.remotes[0]?.name ?? '',
        options: store.remotes.map((remote) => ({ value: remote.name, label: remote.name })),
      },
      { kind: 'text', id: 'branch', label: vi.remote.publishBranch, value: name, monospace: true },
    ],
    validate: (current) =>
      isValidRefName(textValue(current, 'branch')) ? null : vi.remote.invalidRemoteBranch,
  });
  if (!values) return;
  await performPush(
    store,
    {
      localBranch: name,
      remote: textValue(values, 'remote'),
      remoteBranch: textValue(values, 'branch'),
      setUpstream: true,
      force: false,
    },
    options.dialogs,
  );
}

export function performPush(store: RepoStore, request: PushRequest, dialogs?: DialogStore): Promise<void> {
  const progress = store.progressReporter();
  const title = request.force
    ? vi.remote.forcePushTitle(request.localBranch)
    : vi.remote.pushTitle(request.localBranch);
  return store.perform(
    title,
    (git, signal) =>
      git.push({
        remote: request.remote,
        localBranch: request.localBranch,
        remoteBranch: request.remoteBranch,
        setUpstream: request.setUpstream,
        force: request.force,
        onProgress: progress,
        signal,
      }),
    {
      showsProgress: true,
      cancellable: true,
      refresh: Scope.refs | Scope.status,
      onSuccess: () =>
        store.notify(
          'success',
          vi.remote.pushed(request.localBranch, `${request.remote}/${request.remoteBranch}`),
        ),
      onError: (error) => {
        if (handleNetworkError(store, error, title)) return true;
        if (gitErrorContains(error, '[rejected]', 'non-fast-forward', 'fetch first', 'stale info')) {
          store.showError(vi.remote.rejected, error, [
            { title: vi.remote.pullThenPush, run: () => void sync(store, dialogs) },
            { title: vi.remote.pullFirst, run: () => void pull(store) },
            {
              title: vi.remote.forcePush,
              run: () => void confirmForcePush(store, { ...request, force: true }, dialogs),
            },
          ]);
          return true;
        }
        return false;
      },
    },
  );
}

export async function confirmForcePush(
  store: RepoStore,
  request: PushRequest,
  dialogs?: DialogStore,
): Promise<void> {
  const confirmed = await (dialogs ?? globalDialogs).confirm({
    title: vi.remote.forcePushConfirmTitle(request.localBranch),
    message: vi.remote.forcePushConfirmMessage(`${request.remote}/${request.remoteBranch}`),
    confirmTitle: vi.remote.forcePushConfirm,
    destructive: true,
  });
  if (confirmed) await performPush(store, { ...request, force: true }, dialogs);
}
