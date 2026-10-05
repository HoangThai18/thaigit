// Git LFS (like GitKraken): the GIT LFS sidebar section (tracked patterns, fetch / pull / prune), "Track with LFS" in the file menu, and
// pushing LFS files before a push. git-lfs installs its own hooks, so Rust only allows `git lfs …` on a trusted repo.

import type { FileChange, LfsPattern } from '@thaigit/core';
import { dialogs as globalDialogs, textValue, type DialogStore } from '../stores/dialogs.svelte.ts';
import { tidyMenu, type MenuItem } from '../stores/menus.svelte.ts';
import { Scope, type RepoStore } from '../stores/repo.svelte.ts';
import { vi } from '../strings.vi.ts';
import { handleNetworkError } from './errors.ts';

/** The repo uses LFS and the machine has git-lfs: a push must upload the LFS files first. */
export function usesLfs(store: RepoStore): boolean {
  return store.lfsPatterns.length > 0 && typeof store.lfsVersion === 'string';
}

/** The shared menu of the GIT LFS section (the "…" button in its header and a right-click on a pattern). */
function sectionItems(store: RepoStore): (MenuItem | false)[] {
  const installed = typeof store.lfsVersion === 'string';
  return [
    { title: vi.lfs.track, icon: 'plus', run: () => void beginTrackLfs(store) },
    { kind: 'separator' },
    installed && { title: vi.lfs.fetch, icon: 'download', run: () => void fetchLfs(store, false) },
    installed && { title: vi.lfs.pull, icon: 'download', run: () => void fetchLfs(store, true) },
    installed && { title: vi.lfs.prune, icon: 'reset', run: () => void pruneLfs(store) },
  ];
}

export function lfsSectionMenu(store: RepoStore): MenuItem[] {
  return tidyMenu(sectionItems(store));
}

export function lfsPatternMenu(store: RepoStore, pattern: LfsPattern): MenuItem[] {
  return tidyMenu([
    {
      title: vi.lfs.untrack,
      icon: 'trash',
      run: () => void untrackLfs(store, pattern),
    },
    { kind: 'separator' },
    ...sectionItems(store),
  ]);
}

/** The "Git LFS" item in one file's menu: track by extension or track just that file. */
export function lfsFileItems(store: RepoStore, change: FileChange): MenuItem[] {
  if (typeof store.lfsVersion !== 'string') return [];
  const base = change.path.slice(change.path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  const extension = dot > 0 ? base.slice(dot + 1) : '';
  return [
    {
      kind: 'submenu',
      title: vi.lfs.fileMenu,
      icon: 'cloud',
      items: tidyMenu([
        extension !== '' && {
          title: vi.lfs.trackExtension(extension),
          run: () => void beginTrackLfs(store, `*.${extension}`),
        },
        { title: vi.lfs.trackFile, run: () => void beginTrackLfs(store, change.path) },
      ]),
    },
  ];
}

/** Ask for a pattern (prefilled with `initial`), then run `git lfs track`. */
export async function beginTrackLfs(store: RepoStore, initial = '', dialogs?: DialogStore): Promise<void> {
  const values = await (dialogs ?? globalDialogs).form({
    title: vi.lfs.trackTitle,
    message: vi.lfs.trackMessage,
    confirmTitle: vi.lfs.trackConfirm,
    fields: [{ kind: 'text', id: 'pattern', label: vi.lfs.patternLabel, value: initial, monospace: true }],
    validate: (current) => {
      const pattern = textValue(current, 'pattern');
      if (pattern === '') return vi.lfs.patternRequired;
      // An LFS command argument must not start with `-` (the policy blocks it just like a remote URL).
      if (pattern.startsWith('-') || /[\r\n\u0000]/.test(pattern)) return vi.lfs.patternInvalid;
      return null;
    },
  });
  if (!values) return;
  const pattern = textValue(values, 'pattern');
  await trackLfs(store, pattern);
}

export function trackLfs(store: RepoStore, pattern: string): Promise<void> {
  return store.perform(vi.lfs.trackRunning(pattern), (git) => git.lfsTrack(pattern), {
    refresh: Scope.status,
    onSuccess: () => store.notify('success', vi.lfs.tracked(pattern)),
  });
}

export function untrackLfs(store: RepoStore, pattern: LfsPattern): Promise<void> {
  return store.perform(vi.lfs.untrackRunning(pattern.display), (git) => git.lfsUntrack(pattern.pattern), {
    refresh: Scope.status,
    onSuccess: () => store.notify('success', vi.lfs.untracked(pattern.display)),
  });
}

/** `git lfs fetch` (only download into the cache) or `git lfs pull` (download and replace the pointers in the working tree with the real files). */
export function fetchLfs(store: RepoStore, pull: boolean): Promise<void> {
  const title = pull ? vi.lfs.pullRunning : vi.lfs.fetchRunning;
  const progress = store.progressReporter();
  return store.perform(title, (git, signal) => git.lfsFetch(pull, { onProgress: progress, signal }), {
    showsProgress: true,
    cancellable: true,
    refresh: Scope.status,
    onSuccess: () => store.notify('success', pull ? vi.lfs.pulled : vi.lfs.fetched),
    onError: (error) => handleNetworkError(store, error, title),
  });
}

export function pruneLfs(store: RepoStore): Promise<void> {
  return store.perform(vi.lfs.pruneRunning, (git) => git.lfsPrune(), {
    onSuccess: () => store.notify('success', vi.lfs.pruned),
  });
}
