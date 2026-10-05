// Builds the laid-out history from `git log` output — PURE functions (parse + WIP insert + layout) so they can run in
// a Web Worker. Running git lives in `GitRepository.logBytes()` (main thread); the two steps are no longer bundled into
// one call.

import { computeGraphLayout, type GraphRow } from '../graph/layout.ts';
import { workingTreeCommit, type Commit } from './models.ts';
import { parseLog } from './parsers.ts';

/** Commit history with layout applied, ready to draw. */
export interface History {
  /** A synthetic WIP commit may sit at position 0. */
  readonly commits: readonly Commit[];
  readonly rows: readonly GraphRow[];
  /** Number of real commits loaded. */
  readonly loadedCount: number;
  /** True when older commits may still be missing (the limit was hit). */
  readonly mayHaveMore: boolean;
}

export interface BuildHistoryOptions {
  /** Limit passed to `logBytes` (so we know whether older commits remain). */
  limit: number;
  /** Current HEAD commit: the parent of the WIP node (null when the branch has no commits). */
  headOid: string | null;
  showWorkingTree: boolean;
}

export function buildHistory(log: Uint8Array | readonly Commit[], options: BuildHistoryOptions): History {
  const parsed = log instanceof Uint8Array ? parseLog(log) : log;
  const loadedCount = parsed.length;
  const commits = options.showWorkingTree ? [workingTreeCommit(options.headOid), ...parsed] : parsed;
  return {
    commits,
    rows: computeGraphLayout(commits),
    loadedCount,
    mayHaveMore: loadedCount >= options.limit,
  };
}
