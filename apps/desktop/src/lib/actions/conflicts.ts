// Giải xung đột (port phần Xung đột của RepoModel+Diff.swift): chọn cả file một phía, hoặc chọn từng đoạn rồi lưu — ghép theo
// byte (BOM, kiểu xuống dòng, mọi byte ngoài khối xung đột giữ nguyên) và chỉ ghi khi file trên đĩa vẫn là bản đã mở.

import { fileChangeName, type ConflictEntry } from '@thaigit/core';
import { vi } from '../strings.vi.ts';
import { Scope, type RepoStore } from '../stores/repo.svelte.ts';

function nameOf(path: string): string {
  return fileChangeName({ path });
}

/** Dùng toàn bộ bản Current (ours) hoặc Incoming (theirs) của file. */
export function resolveWhole(store: RepoStore, entry: ConflictEntry, useOurs: boolean): Promise<void> {
  return store.perform(
    useOurs ? vi.branches.useCurrentRunning : vi.branches.useIncomingRunning,
    (git) => git.resolveConflict(entry.path, entry.kind, useOurs),
    {
      refresh: Scope.status,
      onSuccess: () => store.notify('success', vi.branches.conflictResolved(nameOf(entry.path))),
    },
  );
}

/** Dùng nguyên bản một phía cho nhiều file xung đột một lần. */
export function resolveMany(
  store: RepoStore,
  entries: readonly ConflictEntry[],
  useOurs: boolean,
): Promise<void> {
  if (entries.length === 0) return Promise.resolve();
  if (entries.length === 1) return resolveWhole(store, entries[0] as ConflictEntry, useOurs);
  return store.perform(
    useOurs ? vi.branches.useCurrentRunning : vi.branches.useIncomingRunning,
    async (git) => {
      for (const entry of entries) await git.resolveConflict(entry.path, entry.kind, useOurs);
    },
    {
      refresh: Scope.status,
      onSuccess: () => store.notify('success', vi.branches.resolvedMany(entries.length)),
    },
  );
}

/**
 * Ghi nội dung đã giải (`content`: ghép theo byte từ các lựa chọn, hoặc người dùng sửa tay) rồi đánh dấu đã giải quyết.
 * Chỉ ghi khi file trên đĩa vẫn là bản đã mở (`sha256`).
 */
export function saveResolution(
  store: RepoStore,
  entry: ConflictEntry,
  sha256: string,
  content: Uint8Array,
): Promise<void> {
  return store.perform(
    vi.branches.saveResolutionRunning,
    async (git) => {
      await git.writeWorkingFile(entry.path, content, sha256);
      await git.markResolved([entry.path]);
    },
    {
      refresh: Scope.status,
      onSuccess: () => store.notify('success', vi.branches.conflictResolved(nameOf(entry.path))),
      onError: (error) => {
        if ((error as { code?: unknown } | null)?.code !== 'conflict') return false;
        // File đã đổi trên đĩa: nạp lại cho người dùng thấy nội dung mới (lựa chọn cũ không còn khớp).
        store.showError(vi.branches.changedOnDisk, error);
        void store.diff.load();
        return true;
      },
    },
  );
}

export function markResolved(store: RepoStore, paths: readonly string[]): Promise<void> {
  return store.perform(vi.branches.markResolvedRunning, (git) => git.markResolved(paths), {
    refresh: Scope.status,
  });
}
