// Working-tree snapshot timeline (shared spec: packages/contracts/snapshot.json). Each worktree gets one ref
// `refs/worktree/thaigit/snapshots`; each marker is an entry in ITS reflog (refs/stash style) so `git log --all` sees at
// most one extra commit. A snapshot commit is the tree of the ENTIRE working tree (respecting .gitignore) built via a
// temporary index in the git dir — it never touches the real index, branches, stash or the user's HEAD.

import {
  formatSnapshotMessage,
  parseSnapshotMessage,
  selectExpiredSnapshots,
  snapshotIdentityEnv,
  snapshotSpec,
  type EnvProfile,
  type SnapshotReason,
} from '@thaigit/contracts';
import { decodeUtf8, encodeUtf8, nulSeparated } from './bytes.ts';
import type { FileChange } from './models.ts';
import { parseNameStatus } from './parsers.ts';
import type { GitRepository } from './repository.ts';
import { GitError, GitRunner } from './runner.ts';

export interface SnapshotEntry {
  /** Position in the reflog (0 = newest) — used to delete (`ref@{index}`). */
  readonly index: number;
  readonly sha: string;
  readonly tree: string;
  /** Capture time (seconds). */
  readonly time: number;
  readonly reason: SnapshotReason;
  /** Files differing from HEAD at capture time; null when unknown. */
  readonly files: number | null;
}

export interface SnapshotTakeOptions {
  /**
   * Background by default (reason `auto`): a busy repo is skipped (`busy` error), nothing goes to the Command log, and it
   * never prompts for sign-in. `false` when the user clicked (the marker taken right before a restore): queues like a normal
   * operation.
   */
  background?: boolean;
}

export interface SnapshotRestoreResult {
  /** Marker captured right before a restore — restoring to it is the Undo action. */
  readonly before: SnapshotEntry;
  /** Files rewritten / removed from the working tree according to the marker. */
  readonly restored: readonly string[];
  /** Untracked files created after the marker, moved into the app's trash. */
  readonly trashed: readonly string[];
}

export interface SnapshotPruneOptions {
  /** Seconds. */
  now: number;
  keepDays: number;
  keepCount: number;
}

const REF = snapshotSpec.ref;
const LITERAL_PATHSPECS = { GIT_LITERAL_PATHSPECS: '1' } as const;
/** `reflog delete` accepts several entries at once; batch them to keep the command line short. */
const PRUNE_BATCH = 100;
/** Paths per `ls-files … -- <paths>` call (keeps the command line under Windows' ~32 KB limit). */
const PATH_BATCH = 100;
const LOG_FIELD = '\x1f';

function isStaleIndexLock(error: unknown): boolean {
  return error instanceof GitError && error.contains('.lock') && error.contains('exists');
}

/** Is `path` in scope for `paths` (the exact file, or inside one of the directories); `null` = every path. */
function inScope(path: string, paths: readonly string[] | null): boolean {
  return paths === null || paths.some((scope) => path === scope || path.startsWith(`${scope}/`));
}

export class SnapshotStore {
  /** The runner does not write to the Command log: automatic captures every few minutes would flood it. */
  private readonly quiet: GitRunner;

  constructor(private readonly repo: GitRepository) {
    this.quiet = new GitRunner(repo.runner.exec);
  }

  /** The markers, newest first (reflog entries that are not Thaigit snapshots are skipped, but real reflog indexes are kept). */
  async list(limit?: number): Promise<SnapshotEntry[]> {
    return this.read(this.repo.runner, limit);
  }

  /**
   * Capture the working tree. A tree identical to the newest marker's returns that marker instead of creating a new one.
   * A `busy` error (a write operation is in progress) while running in the background: the caller skips this round.
   */
  async take(reason: SnapshotReason, options: SnapshotTakeOptions = {}): Promise<SnapshotEntry> {
    const background = options.background ?? reason === 'auto';
    const runner = background ? this.quiet : this.repo.runner;
    const profile: EnvProfile = background ? 'background' : 'interactive';

    let indexFile = await this.repo.fs.prepareSnapshotIndex(false);
    try {
      await runner.run('add', ['-A'], { env: { GIT_INDEX_FILE: indexFile }, profile });
    } catch (error) {
      if (!isStaleIndexLock(error)) throw error;
      // An orphaned lock when the app is killed mid-`git add` is harmless: the temporary index is only a buffer and is rebuilt from scratch.
      indexFile = await this.repo.fs.prepareSnapshotIndex(true);
      await runner.run('add', ['-A'], { env: { GIT_INDEX_FILE: indexFile }, profile });
    }
    const indexEnv = { GIT_INDEX_FILE: indexFile };
    const tree = (await runner.text('write-tree', [], { env: indexEnv, profile })).trim();

    const [latest] = await this.read(runner, 1);
    if (latest !== undefined && latest.index === 0 && latest.tree === tree) return latest;

    const headOut = await runner.run('rev-parse', ['--verify', '-q', 'HEAD'], { acceptExitCodes: [0, 1] });
    const head = headOut.code === 0 ? decodeUtf8(headOut.stdout).trim() : null;
    const changed = await runner.run('diff', ['--cached', '--name-only', '-z'], {
      env: { ...indexEnv, GIT_OPTIONAL_LOCKS: '0' },
      profile,
    });
    const files = decodeUtf8(changed.stdout)
      .split('\0')
      .filter((path) => path !== '').length;

    const sha = (
      await runner.text(
        'commit-tree',
        [tree, ...(head !== null ? ['-p', head] : []), '--no-gpg-sign', '-F', '-'],
        {
          stdin: encodeUtf8(formatSnapshotMessage(reason, files)),
          env: snapshotIdentityEnv(),
          profile,
        },
      )
    ).trim();
    await runner.run('update-ref', ['--create-reflog', '-m', snapshotSpec.reflogMessage, REF, sha], {
      profile,
    });
    const [entry] = await this.read(runner, 1);
    return entry ?? { index: 0, sha, tree, time: Math.floor(Date.now() / 1000), reason, files };
  }

  /** Files differing between two markers (`from` → `to`). */
  async changes(from: string, to: string): Promise<FileChange[]> {
    return this.repo.changedFiles(to, from);
  }

  /** Diff one file between two markers (raw bytes, like a commit diff). */
  async diffBytes(from: string, to: string, file: FileChange): Promise<Uint8Array> {
    return this.repo.commitDiffBytes(to, from, file);
  }

  /**
   * Restore the working tree (entirely, or only `paths` — files or directories) to match `target`. A "before restore"
   * marker is always captured first; only the working tree is written (index, branches and stash stay untouched).
   * Untracked files created after the marker are moved into the app's trash rather than deleted.
   */
  async restore(target: string, paths: readonly string[] | null): Promise<SnapshotRestoreResult> {
    const before = await this.take('before-restore', { background: false });
    const runner = this.repo.runner;
    const diff = await runner.run('diff-tree', [
      '-r',
      '-z',
      '--name-status',
      '--no-renames',
      target,
      before.sha,
    ]);
    const changes = parseNameStatus(diff.stdout).filter((change) => inScope(change.path, paths));
    if (changes.length === 0) return { before, restored: [], trashed: [] };

    // Present now but absent from the marker: `restore --source` deletes tracked files itself; untracked ones go to the trash.
    const added = changes.filter((change) => change.kind === 'added').map((change) => change.path);
    const trackedPaths = new Set<string>();
    // `ls-files` has no `--pathspec-from-file`: paths go after `--` (batched for the Windows command-line limit).
    for (let start = 0; start < added.length; start += PATH_BATCH) {
      const batch = added.slice(start, start + PATH_BATCH);
      const out = await runner.run('ls-files', ['-z', '--cached', '--', ...batch], {
        env: LITERAL_PATHSPECS,
      });
      for (const path of decodeUtf8(out.stdout).split('\0')) trackedPaths.add(path);
    }
    const untracked = added.filter((path) => !trackedPaths.has(path));
    const restored = changes.map((change) => change.path).filter((path) => !untracked.includes(path));
    if (untracked.length > 0) await this.repo.fs.trashUntracked(untracked);
    if (restored.length > 0) {
      await runner.run(
        'restore',
        [`--source=${target}`, '--worktree', '--pathspec-from-file=-', '--pathspec-file-nul'],
        { stdin: nulSeparated(restored), env: LITERAL_PATHSPECS },
      );
    }
    return { before, restored, trashed: untracked };
  }

  /** Delete markers past their age / count limit (shared rule `selectExpiredSnapshots`); returns how many were deleted. */
  async prune(options: SnapshotPruneOptions): Promise<number> {
    const entries = await this.readTimes(this.quiet);
    const expired = selectExpiredSnapshots(entries, options.now, options.keepDays, options.keepCount);
    for (let start = 0; start < expired.length; start += PRUNE_BATCH) {
      const batch = expired.slice(start, start + PRUNE_BATCH).map((index) => `${REF}@{${index}}`);
      await this.quiet.run('reflog', ['delete', '--rewrite', ...batch], { profile: 'background' });
    }
    return expired.length;
  }

  private async exists(runner: GitRunner): Promise<boolean> {
    const out = await runner.run('rev-parse', ['--verify', '-q', REF], { acceptExitCodes: [0, 1] });
    return out.code === 0;
  }

  private async read(runner: GitRunner, limit?: number): Promise<SnapshotEntry[]> {
    if (!(await this.exists(runner))) return [];
    const args = ['-g', '-z', '--format=%H%x1f%T%x1f%ct%x1f%B'];
    if (limit !== undefined) args.push(`--max-count=${Math.max(1, Math.trunc(limit))}`);
    const out = await runner.text('log', [...args, REF, '--']);
    const entries: SnapshotEntry[] = [];
    out.split('\0').forEach((record, index) => {
      if (record === '') return;
      const [sha = '', tree = '', time = '', ...body] = record.split(LOG_FIELD);
      const meta = parseSnapshotMessage(body.join(LOG_FIELD));
      if (meta === null) return;
      entries.push({ index, sha, tree, time: Number(time), reason: meta.reason, files: meta.files });
    });
    return entries;
  }

  /** Every reflog entry (including non-snapshots) — the pruning rules work on real reflog indexes. */
  private async readTimes(runner: GitRunner): Promise<{ index: number; time: number }[]> {
    if (!(await this.exists(runner))) return [];
    const out = await runner.text('log', ['-g', '-z', '--format=%ct', REF, '--']);
    return out
      .split('\0')
      .filter((record) => record !== '')
      .map((record, index) => ({ index, time: Number(record.trim()) }));
  }
}
