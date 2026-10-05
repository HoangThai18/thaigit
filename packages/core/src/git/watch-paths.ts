// Classifies changes inside the .git directory (port of RepoWatcher.classifyGitPath). REFERENCE version: the app's
// watcher runs in Rust (phase 2) and uses the same rule table; the TS version stays to test the table and to serve as
// a cross-check vector for `cargo test`.

import { snapshotSpec, type RepoChangeKind } from '@thaigit/contracts';

const IGNORED_PREFIXES = [
  'objects/',
  'logs/',
  'lfs/',
  'hooks/',
  'info/',
  'modules/',
  'fsmonitor',
  'gc.',
  'FETCH_HEAD',
  'ORIG_HEAD.lock',
];

/** The app's per-worktree snapshot ref directory (`refs/worktree/thaigit/`). */
const SNAPSHOT_REF_DIR = snapshotSpec.ref.slice(0, snapshotSpec.ref.lastIndexOf('/') + 1);

/** `relative` is a path relative to the git directory (using `/`). Returns `[]` when the UI need not refresh. */
export function classifyGitPath(relative: string): RepoChangeKind[] {
  if (relative === '') return [];
  if (IGNORED_PREFIXES.some((prefix) => relative.startsWith(prefix))) return [];
  if (relative.endsWith('.lock')) return [];
  // App snapshots (including those of other worktrees visible through the common dir) are not user changes.
  if (relative.startsWith(SNAPSHOT_REF_DIR) || relative.includes(`/${SNAPSHOT_REF_DIR}`)) return [];
  if (relative === 'index') return ['workingTree'];
  if (
    relative === 'HEAD' ||
    relative === 'packed-refs' ||
    relative.startsWith('refs/') ||
    relative.startsWith('rebase-') ||
    relative.endsWith('_HEAD') ||
    relative.startsWith('sequencer') ||
    relative === 'BISECT_LOG' ||
    relative.startsWith('worktrees/')
  ) {
    return ['refs', 'workingTree'];
  }
  return [];
}
