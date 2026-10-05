// Worktrees and submodules (like GitKraken): the sidebar section, adding / removing / pruning worktrees, updating submodules, and
// opening a worktree / submodule in a new window. The folder for a new worktree is picked with a native dialog (Rust issues a token, like clone); for a new
// window Rust verifies that git itself confirms the path is a worktree / submodule of the repo.

import { isValidRefName, type Submodule, type Worktree } from '@thaigit/core';
import { pickRepoFolder } from '../ipc/host.ts';
import type { PickedFolder } from '../ipc/types.ts';
import {
  dialogs as globalDialogs,
  flagValue,
  textValue,
  type DialogStore,
} from '../stores/dialogs.svelte.ts';
import { tidyMenu, type MenuItem } from '../stores/menus.svelte.ts';
import { Scope, type RepoStore } from '../stores/repo.svelte.ts';
import { vi } from '../strings.vi.ts';
import { gitErrorContains, handleNetworkError } from './errors.ts';

const INVALID_FOLDER = /[/\\:*?"<>|\u0000-\u001f]/;

/** A short name for a worktree: its branch, or "detached @ sha", or the folder name. */
export function worktreeName(worktree: Worktree): string {
  if (worktree.branch !== null) return worktree.branch;
  if (worktree.head !== null) return vi.related.worktreeDetached(worktree.head.slice(0, 7));
  return worktree.path.split(/[/\\]/).pop() ?? worktree.path;
}

function samePath(a: string, b: string): boolean {
  const normalize = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  return normalize(a) === normalize(b);
}

export function isCurrentWorktree(store: RepoStore, worktree: Worktree): boolean {
  return samePath(worktree.path, store.rootPath);
}

async function openRelated(store: RepoStore, kind: 'worktree' | 'submodule', path: string): Promise<void> {
  try {
    await store.port.openRelated?.(kind, path);
  } catch (error) {
    store.showError(vi.related.openFailed, error);
  }
}

/** Open a worktree in a new window (double-click in the sidebar) — except the currently open worktree and one whose folder is gone. */
export function openWorktree(store: RepoStore, worktree: Worktree): void {
  if (isCurrentWorktree(store, worktree) || worktree.prunable) return;
  void openRelated(store, 'worktree', worktree.path);
}

export function worktreeMenu(store: RepoStore, worktree: Worktree, index: number): MenuItem[] {
  const current = isCurrentWorktree(store, worktree);
  return tidyMenu([
    store.port.openRelated &&
      !current &&
      !worktree.prunable && {
        title: vi.related.openInNewWindow,
        icon: 'folder-open',
        run: () => void openRelated(store, 'worktree', worktree.path),
      },
    {
      title: vi.related.copyPath,
      icon: 'copy',
      run: () => void store.copy(worktree.path, vi.related.pathLabel),
    },
    { kind: 'separator' },
    // The first worktree is the main one — git cannot remove it.
    index > 0 &&
      !current && {
        title: vi.related.removeWorktree,
        icon: 'trash',
        destructive: true,
        run: () => void removeWorktree(store, worktree),
      },
    worktree.prunable && {
      title: vi.related.pruneWorktrees,
      icon: 'reset',
      run: () => void pruneWorktrees(store),
    },
  ]);
}

export function submoduleMenu(store: RepoStore, submodule: Submodule): MenuItem[] {
  return tidyMenu([
    store.port.openRelated &&
      submodule.state !== 'uninitialized' && {
        title: vi.related.openInNewWindow,
        icon: 'folder-open',
        run: () => void openRelated(store, 'submodule', submodule.path),
      },
    {
      title: vi.related.updateSubmodule,
      icon: 'download',
      run: () => void updateSubmodules(store, [submodule.path]),
    },
    { kind: 'separator' },
    {
      title: vi.related.updateAllSubmodules,
      icon: 'download',
      run: () => void updateSubmodules(store, null),
    },
    { title: vi.related.syncSubmodules, icon: 'reset', run: () => void syncSubmodules(store) },
    { kind: 'separator' },
    {
      title: vi.related.copyPath,
      icon: 'copy',
      run: () => void store.copy(submodule.path, vi.related.pathLabel),
    },
  ]);
}

/** Pick a parent folder (native dialog), then ask for the branch + folder name, then add the worktree. */
export async function beginAddWorktree(
  store: RepoStore,
  options: { dialogs?: DialogStore; pickFolder?: () => Promise<PickedFolder | null> } = {},
): Promise<void> {
  const dialogs = options.dialogs;
  let folder: PickedFolder | null;
  try {
    folder = await (options.pickFolder ?? pickRepoFolder)();
  } catch (error) {
    store.showError(vi.related.openFailed, error);
    return;
  }
  if (!folder) return;
  const locals = new Set(store.localBranches.map((ref) => ref.fullName.slice('refs/heads/'.length)));
  const checkedOut = new Set(store.worktrees.flatMap((item) => (item.branch === null ? [] : [item.branch])));
  const repoName = store.name;
  const values = await (dialogs ?? globalDialogs).form({
    title: vi.related.addTitle,
    message: vi.related.addMessage(folder.path),
    confirmTitle: vi.related.addConfirm,
    fields: [
      { kind: 'text', id: 'branch', label: vi.related.branchLabel, value: '', monospace: true },
      { kind: 'checkbox', id: 'create', label: vi.related.createBranch, value: true },
      { kind: 'text', id: 'folder', label: vi.related.folderLabel, value: '', placeholder: `${repoName}-…` },
    ],
    validate: (current) => {
      const branch = textValue(current, 'branch');
      const create = flagValue(current, 'create');
      if (branch === '') return vi.related.branchRequired;
      if (!isValidRefName(branch)) return vi.related.branchInvalid;
      if (create && locals.has(branch)) return vi.related.branchExists(branch);
      if (!create && !locals.has(branch)) return vi.related.branchMissing(branch);
      if (!create && checkedOut.has(branch)) return vi.related.branchCheckedOut(branch);
      const name = textValue(current, 'folder') || defaultFolder(repoName, branch);
      if (name === '.' || name === '..' || INVALID_FOLDER.test(name)) return vi.related.folderInvalid;
      return null;
    },
  });
  if (!values) return;
  const branch = textValue(values, 'branch');
  const name = textValue(values, 'folder') || defaultFolder(repoName, branch);
  let path: string | null = null;
  await store.perform(
    vi.related.addRunning(branch),
    async (git) => {
      path = await git.addWorktree(folder.token, name, branch, flagValue(values, 'create'));
    },
    {
      refresh: Scope.all,
      onSuccess: () => {
        const created: string | null = path;
        store.notify('success', vi.related.added(branch), {
          actions:
            created !== null && store.port.openRelated
              ? [
                  {
                    title: vi.related.openInNewWindow,
                    run: () => void openRelated(store, 'worktree', created),
                  },
                ]
              : [],
        });
      },
    },
  );
}

/** "repo-feature-x": the repo name plus the branch name, dropping characters invalid in a folder name. */
export function defaultFolder(repoName: string, branch: string): string {
  return `${repoName}-${branch}`.replace(/[/\\:*?"<>|\s]+/g, '-');
}

export async function removeWorktree(
  store: RepoStore,
  worktree: Worktree,
  dialogs?: DialogStore,
): Promise<void> {
  const name = worktreeName(worktree);
  const ask = dialogs ?? globalDialogs;
  const confirmed = await ask.confirm({
    title: vi.related.removeConfirmTitle(name),
    message: vi.related.removeConfirmMessage,
    confirmTitle: vi.related.removeConfirm,
    destructive: true,
  });
  if (!confirmed) return;
  await store.perform(vi.related.removeRunning(name), (git) => git.removeWorktree(worktree.path, false), {
    refresh: Scope.all,
    onSuccess: () => store.notify('success', vi.related.removed(name)),
    onError: (error) => {
      if (!gitErrorContains(error, 'contains modified or untracked files', 'use --force')) return false;
      void (async () => {
        const force = await ask.confirm({
          title: vi.related.forceRemoveTitle(name),
          message: vi.related.forceRemoveMessage,
          confirmTitle: vi.related.forceRemove,
          destructive: true,
        });
        if (!force) return;
        await store.perform(
          vi.related.removeRunning(name),
          (git) => git.removeWorktree(worktree.path, true),
          {
            refresh: Scope.all,
            onSuccess: () => store.notify('success', vi.related.removed(name)),
          },
        );
      })();
      return true;
    },
  });
}

export function pruneWorktrees(store: RepoStore): Promise<void> {
  return store.perform(vi.related.pruneRunning, (git) => git.pruneWorktrees(), {
    refresh: Scope.all,
    onSuccess: () => store.notify('success', vi.related.pruned),
  });
}

/** `submodule update --init --recursive` (paths null = all) — this may clone over the network. */
export function updateSubmodules(store: RepoStore, paths: readonly string[] | null): Promise<void> {
  const title = vi.related.updateRunning(paths === null ? null : paths.length);
  return store.perform(title, (git) => git.updateSubmodules(paths), {
    refresh: Scope.all,
    onSuccess: () => store.notify('success', vi.related.updated),
    onError: (error) => handleNetworkError(store, error, title),
  });
}

export function syncSubmodules(store: RepoStore): Promise<void> {
  return store.perform(vi.related.syncRunning, (git) => git.syncSubmodules(), {
    refresh: Scope.all,
    onSuccess: () => store.notify('success', vi.related.synced),
  });
}
