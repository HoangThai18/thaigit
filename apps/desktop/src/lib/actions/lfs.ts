// Git LFS (như GitKraken): mục GIT LFS ở sidebar (mẫu đang track, fetch / pull / prune), "Track bằng LFS" trong menu file, và
// đẩy file LFS trước khi push. git-lfs tự cài hook nên Rust chỉ cho chạy `git lfs …` khi repo đã được tin tưởng.

import type { FileChange, LfsPattern } from '@thaigit/core';
import { dialogs as globalDialogs, textValue, type DialogStore } from '../stores/dialogs.svelte.ts';
import { tidyMenu, type MenuItem } from '../stores/menus.svelte.ts';
import { Scope, type RepoStore } from '../stores/repo.svelte.ts';
import { vi } from '../strings.vi.ts';
import { handleNetworkError } from './errors.ts';

/** Repo dùng LFS và máy có git-lfs: push phải đẩy file LFS trước. */
export function usesLfs(store: RepoStore): boolean {
  return store.lfsPatterns.length > 0 && typeof store.lfsVersion === 'string';
}

/** Menu chung của mục GIT LFS (nút "…" ở tiêu đề và chuột phải vào một mẫu). */
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

/** Mục "Git LFS" trong menu một file trên đĩa: track theo đuôi file hoặc riêng file đó. */
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

/** Hỏi mẫu (điền sẵn `initial`) rồi `git lfs track`. */
export async function beginTrackLfs(store: RepoStore, initial = '', dialogs?: DialogStore): Promise<void> {
  const values = await (dialogs ?? globalDialogs).form({
    title: vi.lfs.trackTitle,
    message: vi.lfs.trackMessage,
    confirmTitle: vi.lfs.trackConfirm,
    fields: [{ kind: 'text', id: 'pattern', label: vi.lfs.patternLabel, value: initial, monospace: true }],
    validate: (current) => {
      const pattern = textValue(current, 'pattern');
      if (pattern === '') return vi.lfs.patternRequired;
      // Đối số lệnh LFS không được mở đầu bằng `-` (chính sách chặn như URL remote).
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

/** `git lfs fetch` (chỉ tải về bộ nhớ đệm) hoặc `git lfs pull` (tải và thay con trỏ trong working tree bằng file thật). */
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
