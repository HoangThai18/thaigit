/**
 * Snapshot (working-tree timeline) spec: constants read from `snapshot.json`, the snapshot
 * commit message format, and the pruning rules for old markers. Shared test cases: `snapshot.vectors.json`.
 */
import spec from '../snapshot.json' with { type: 'json' };

export const SNAPSHOT_REASONS = ['auto', 'before-restore', 'manual'] as const;
export type SnapshotReason = (typeof SNAPSHOT_REASONS)[number];

export interface SnapshotSpec {
  version: number;
  /** Per-worktree ref; each marker is one of its reflog entries. */
  ref: string;
  /** Temporary index, relative to the worktree's git dir. */
  indexFile: string;
  messageHeader: string;
  reflogMessage: string;
  identity: { name: string; email: string };
  reasons: readonly SnapshotReason[];
  defaults: {
    quietMs: number;
    minIntervalMs: number;
    keepDays: number;
    keepCount: number;
    pruneIntervalMs: number;
  };
}

export const snapshotSpec: SnapshotSpec = spec as SnapshotSpec;

export interface SnapshotMeta {
  reason: SnapshotReason;
  /** Files differing from HEAD at capture time; null when missing or invalid. */
  files: number | null;
}

/** Fixed identity env for `commit-tree` (the policy only accepts exactly these values). */
export function snapshotIdentityEnv(): Record<string, string> {
  const { name, email } = snapshotSpec.identity;
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
  };
}

export function formatSnapshotMessage(reason: SnapshotReason, files: number): string {
  return `${snapshotSpec.messageHeader}\n\nreason: ${reason}\nfiles: ${files}\n`;
}

/** Snapshot commit message (%B) → metadata; null when the first line is not `messageHeader`. */
export function parseSnapshotMessage(message: string): SnapshotMeta | null {
  const lines = message.split('\n').map((line) => line.replace(/\r$/, ''));
  if (lines[0] !== snapshotSpec.messageHeader) return null;
  let reason: SnapshotReason = 'auto';
  let files: number | null = null;
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key === 'reason') {
      reason = (SNAPSHOT_REASONS as readonly string[]).includes(value) ? (value as SnapshotReason) : 'auto';
    } else if (key === 'files') {
      files = /^\d+$/.test(value) ? Number(value) : null;
    }
  }
  return { reason, files };
}

/**
 * Reflog entries to delete (descending — delete oldest first so remaining indexes stay stable). `entries` pairs `index` =
 * position in the reflog (0 = newest) with `time` in seconds. Entry 0 is never deleted; an entry goes when
 * `index >= keepCount` or it is older than `keepDays` days (future timestamps from clock skew are kept).
 */
export function selectExpiredSnapshots(
  entries: readonly { index: number; time: number }[],
  now: number,
  keepDays: number,
  keepCount: number,
): number[] {
  const maxAge = keepDays * 86_400;
  return entries
    .filter((entry) => entry.index > 0 && (entry.index >= keepCount || now - entry.time > maxAge))
    .map((entry) => entry.index)
    .sort((a, b) => b - a);
}
