// Conflict resolution (a port of the Conflicts part of RepoModel+Diff.swift): take one whole side of a file, or pick per hunk
// and save — merged byte-wise (BOM, line terminators and every byte outside the conflict blocks are preserved) and written only while the file on disk is still the version that was opened.

import { fileChangeName, type ConflictEntry } from '@thaigit/core';
import { vi } from '../strings.vi.ts';
import { Scope, type RepoStore } from '../stores/repo.svelte.ts';

function nameOf(path: string): string {
  return fileChangeName({ path });
}

/** Take the whole Current (ours) or Incoming (theirs) version of the file. */
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

/** Take one side verbatim for several conflicting files at once. */
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
 * Write the resolved content (`content`: merged byte-wise from the selections, or edited by hand) and mark it resolved.
 * Written only while the file on disk is still the version that was opened (`sha256`).
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
        // The file changed on disk: reload so the user sees the new content (the old selections no longer match).
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
