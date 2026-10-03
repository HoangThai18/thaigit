// Giải xung đột (port phần Xung đột của RepoModel+Diff.swift): chọn cả file một phía, hoặc chọn từng đoạn rồi lưu — ghép theo
// byte (BOM, kiểu xuống dòng, mọi byte ngoài khối xung đột giữ nguyên) và chỉ ghi khi file trên đĩa vẫn là bản đã mở.

import { fileChangeName, resolveConflicts, type ConflictChoices, type ConflictEntry, type ConflictFile } from '@thaigit/core';
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
    { refresh: Scope.status, onSuccess: () => store.notify('success', vi.branches.conflictResolved(nameOf(entry.path))) },
  );
}

/** Ghi file đã chọn xong mọi đoạn rồi đánh dấu đã giải quyết. */
export function saveResolution(
  store: RepoStore,
  entry: ConflictEntry,
  file: ConflictFile,
  sha256: string,
  choices: ConflictChoices,
): Promise<void> {
  const content = resolveConflicts(file, choices);
  if (content === null) {
    store.notify('warning', vi.branches.unresolvedBlocks);
    return Promise.resolve();
  }
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
  return store.perform(vi.branches.markResolvedRunning, (git) => git.markResolved(paths), { refresh: Scope.status });
}
