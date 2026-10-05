// The Git repository and every operation Thaigit performs on it (port of GitRepository.swift). Each method runs one or
// a few `git` commands through `Exec`; all file I/O goes through `RepoFs`. Diff/patch parsing does NOT happen here
// (see the `diff/` module): diff methods return raw bytes and the staging code consumes byte patches. `exec` (main
// thread) and parsing (worker) are separated: e.g. `logBytes()` returns bytes and `parseLog()` is pure.
//
// Validator safety conventions (git-policy.json): free-form strings (a commit message…) travel via stdin (`-F -`) or as
// `--opt=value`; paths travel via `--pathspec-from-file=- --pathspec-file-nul` or after `--` together with
// `GIT_LITERAL_PATHSPECS=1`; short flags never carry a value. Branch/rev/remote names must not start with `-` (so they
// cannot be mistaken for options).

import { NO_REF_FILTER, refFilterRevisionArgs, type GraphRefFilter } from '../graph/refFilter.ts';
import type { EnvProfile } from '@thaigit/contracts';
import type { Exec, RepoFs, TypedGit } from '../ports/index.ts';
import type { CommandLog } from '../support/command-log.ts';
import { osBasename } from '../support/paths.ts';
import { decodeUtf8, encodeUtf8, nulSeparated } from './bytes.ts';
import {
  fileChange,
  fileChangeAllPaths,
  type Blame,
  type Commit,
  type CommitDetails,
  type ConflictKind,
  type FileChange,
  type FileHistoryEntry,
  type GitRef,
  type Submodule,
  type Worktree,
  type LogOrder,
  type MergeStyle,
  type PullMode,
  type Remote,
  type RepoOperation,
  type ResetMode,
  type Stash,
  type WorkingDiffKind,
  type WorkingTreeStatus,
} from './models.ts';
import {
  FILE_HISTORY_FORMAT,
  LOG_FORMAT,
  REF_FORMAT,
  STASH_FORMAT,
  parseBlame,
  parseFileHistory,
  parseLog,
  parseNameStatus,
  parseRefs,
  parseRemotes,
  parseStashList,
  parseStatus,
  parseSubmoduleStatus,
  parseWorktrees,
} from './parsers.ts';
import { parseLfsPatterns, type LfsPattern } from './lfs.ts';
import { rebaseRequest, type InteractiveRebaseResult, type RebaseStep } from './rebase.ts';
import { isValidRefName, isValidRemoteName } from './refname.ts';
import { AdapterError, GitError, GitRunner } from './runner.ts';

export type RepositoryErrorKind = 'notARepository' | 'bareRepository' | 'invalidName';

/** Failure to open a repository or an invalid argument (Vietnamese message, like the Swift version). */
export class RepositoryError extends Error {
  readonly kind: RepositoryErrorKind;
  /** The path (notARepository/bareRepository) or the rejected name (invalidName). */
  readonly subject: string;

  constructor(kind: RepositoryErrorKind, subject: string) {
    super(repositoryErrorMessage(kind, subject));
    this.name = 'RepositoryError';
    this.kind = kind;
    this.subject = subject;
  }
}

function repositoryErrorMessage(kind: RepositoryErrorKind, subject: string): string {
  switch (kind) {
    case 'notARepository':
      return `“${subject}” không phải là một Git repository.`;
    case 'bareRepository':
      return `“${subject}” là bare repository (không có working tree) — Thaigit chưa hỗ trợ loại này.`;
    case 'invalidName':
      return `Tên “${subject}” không hợp lệ.`;
  }
}

export interface GitRepositoryOptions {
  exec: Exec;
  fs: RepoFs;
  /** Working-tree root, already normalised (realpath) by the repo opener. */
  root: string;
  gitDir: string;
  commonDir: string;
  /** Command log (credentials redacted on write). */
  log?: CommandLog;
  /** Typed commands (config set, remote add/set-url). Without it those methods report a clear error. */
  typed?: TypedGit;
}

export interface LogOptions {
  limit: number;
  order: LogOrder;
  /** Add `HEAD` (needed when HEAD is detached or the current branch is not in `--branches`). */
  includeHead: boolean;
  includeRemotes?: boolean;
  includeTags?: boolean;
  /** Hide branches on the graph, or restrict it to one. */
  filter?: GraphRefFilter;
}

/** Options shared by network commands. */
export interface NetworkOptions {
  onProgress?: (line: string) => void;
  /** Staged cancellation (only `network` commands). */
  signal?: AbortSignal;
  /** `background` for autofetch: never opens a sign-in dialog. */
  profile?: EnvProfile;
}

export interface FetchOptions extends NetworkOptions {
  /** Default (null/undefined) = `--all`. */
  remote?: string | null;
  prune?: boolean;
}

/**
 * Repos with missing history or remote branches: shallow clones (`--depth`), or remotes that fetch only a few branches
 * (`--single-branch`, hand-edited refspecs). A remote branch like `main` then never reaches the machine, not even on Fetch.
 */
export interface HistoryGaps {
  /** Shallow clone: older commits are missing (`git rev-parse --is-shallow-repository`). */
  shallow: boolean;
  /** The remote has fetch refspecs but none of them fetches `refs/heads/*`. */
  narrowRemotes: string[];
}

/** Do the fetch refspecs cover every branch of the remote (`[+]refs/heads/*:…`; exclude refspecs `^…` are ignored)? */
export function tracksAllBranches(refspecs: readonly string[]): boolean {
  return refspecs.some((spec) => spec.replace(/^\+/, '').split(':', 1)[0] === 'refs/heads/*');
}

/** `git config -z --get-regexp '^remote\..+\.fetch$'` output ("key\nvalue\0"…) → refspecs keyed by remote name. */
export function parseFetchRefspecs(output: string): Map<string, string[]> {
  const byRemote = new Map<string, string[]>();
  for (const entry of output.split('\0')) {
    const newline = entry.indexOf('\n');
    if (newline < 0) continue;
    const key = entry.slice(0, newline);
    // Git writes section and variable names in lowercase; the remote name (subsection) keeps its case and may contain dots.
    if (!key.toLowerCase().startsWith('remote.') || !key.toLowerCase().endsWith('.fetch')) continue;
    const name = key.slice('remote.'.length, -'.fetch'.length);
    if (name === '') continue;
    byRemote.set(name, [...(byRemote.get(name) ?? []), entry.slice(newline + 1)]);
  }
  return byRemote;
}

export interface PushOptions extends NetworkOptions {
  remote: string;
  localBranch: string;
  remoteBranch: string;
  setUpstream?: boolean;
  /** `--force-with-lease`. */
  force?: boolean;
}

export interface CommitOptions {
  amend?: boolean;
  allowEmpty?: boolean;
}

export interface ApplyPatchOptions {
  /** Apply to the index instead of the working tree. */
  cached: boolean;
  reverse: boolean;
  /**
   * Allow a patch with no context lines (`-U0`): git rejects those without `--unidiff-zero`. Enable only for patches
   * generated with `-U0` (git cannot verify positions from context, so it relies entirely on the hunk's line numbers).
   */
  unidiffZero?: boolean;
}

const LITERAL_PATHSPECS = { GIT_LITERAL_PATHSPECS: '1' } as const;
const NO_OPTIONAL_LOCKS = { GIT_OPTIONAL_LOCKS: '0' } as const;
const DIFF_ENV = { ...LITERAL_PATHSPECS, ...NO_OPTIONAL_LOCKS } as const;

/** Subcommand driving each in-progress operation (`<sub> --abort|--continue|--skip`); bisect has its own rules. */
const OPERATION_SUBCOMMAND = {
  merging: 'merge',
  rebasing: 'rebase',
  cherryPicking: 'cherry-pick',
  reverting: 'revert',
  applyingPatches: 'am',
} as const;

/** Ref/remote/rev name placed in argv: non-empty, not starting with `-` (so it is not read as an option), no NUL or newline. */
function assertArgument(value: string): void {
  if (value === '' || value.startsWith('-') || /[\0\r\n]/.test(value))
    throw new RepositoryError('invalidName', value);
}

/** Piece spliced into a refspec: it must be a valid branch/tag name (a `:` or `+` would change the refspec's meaning). */
function assertRefspecName(value: string, branch: boolean): void {
  if (!isValidRefName(value, branch)) throw new RepositoryError('invalidName', value);
}

function assertContext(context: number): void {
  if (!Number.isInteger(context) || context < 0 || context > 1_000_000)
    throw new RangeError(`Số dòng ngữ cảnh không hợp lệ: ${context}`);
}

function assertNoNul(value: string): void {
  if (value.includes('\0')) throw new RepositoryError('invalidName', value.replaceAll('\0', '\\0'));
}

function parseOptionalInt(text: string | null): number | null {
  if (text === null) return null;
  const trimmed = text.trim();
  return /^[+-]?\d+$/.test(trimmed) ? Number(trimmed) : null;
}

export class GitRepository {
  readonly root: string;
  readonly gitDir: string;
  readonly commonDir: string;
  readonly runner: GitRunner;
  readonly fs: RepoFs;
  private readonly typed: TypedGit | undefined;

  constructor(options: GitRepositoryOptions) {
    this.root = options.root;
    this.gitDir = options.gitDir;
    this.commonDir = options.commonDir;
    this.fs = options.fs;
    this.runner = new GitRunner(options.exec, options.log);
    this.typed = options.typed;
  }

  get name(): string {
    return osBasename(this.root);
  }

  // MARK: - Reading data

  async refs(): Promise<GitRef[]> {
    const out = await this.runner.run('for-each-ref', [
      `--format=${REF_FORMAT}`,
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ]);
    return parseRefs(out.stdout);
  }

  async status(): Promise<WorkingTreeStatus> {
    const out = await this.runner.run(
      'status',
      ['--porcelain=v2', '--branch', '--show-stash', '-z', '--untracked-files=all'],
      {
        env: NO_OPTIONAL_LOCKS,
      },
    );
    return parseStatus(out.stdout);
  }

  async stashes(): Promise<Stash[]> {
    const out = await this.runner.run('stash', ['list', '-z', `--format=${STASH_FORMAT}`]);
    return parseStashList(out.stdout);
  }

  async remotes(): Promise<Remote[]> {
    return parseRemotes(await this.runner.text('remote', ['-v']));
  }

  /**
   * Raw `git log -z` output (for parsing + lane layout in a worker via `buildHistory`). A repo with no commits → empty
   * bytes. History covers every local branch, optionally remotes/tags, and HEAD.
   */
  async logBytes(options: LogOptions): Promise<Uint8Array> {
    const args = [
      '-z',
      `--format=${LOG_FORMAT}`,
      options.order === 'topo' ? '--topo-order' : '--date-order',
      `--max-count=${Math.max(1, Math.trunc(options.limit))}`,
      ...refFilterRevisionArgs(options.filter ?? NO_REF_FILTER, {
        includeHead: options.includeHead,
        includeRemotes: options.includeRemotes ?? true,
        includeTags: options.includeTags ?? true,
      }),
    ];
    args.push('--');
    try {
      return (await this.runner.run('log', args)).stdout;
    } catch (error) {
      if (
        error instanceof GitError &&
        (error.contains('does not have any commits') ||
          error.contains('bad default revision') ||
          error.contains('unknown revision') ||
          // `HEAD` is the only literal revision in the command: a repo with no commits makes git report "bad revision 'HEAD'".
          error.contains('bad revision'))
      ) {
        return new Uint8Array(0);
      }
      throw error;
    }
  }

  /** `logBytes` + `parseLog` on one thread (convenient for tests and small repos; the app uses a worker). */
  async log(options: LogOptions): Promise<Commit[]> {
    return parseLog(await this.logBytes(options));
  }

  async commitMessage(sha: string): Promise<string> {
    assertArgument(sha);
    return this.runner.text('show', ['-s', '--format=%B', sha, '--']);
  }

  /** Commit as an email patch (like `git format-patch -1 --stdout`) — reapplicable with `git am`. */
  async commitPatch(sha: string): Promise<string> {
    assertArgument(sha);
    return this.runner.text('show', [
      '--format=email',
      '--patch',
      '--stat',
      '--binary',
      '--no-color',
      sha,
      '--',
    ]);
  }

  /** Files changed in a commit (against its first parent; a root commit against the empty tree). */
  async changedFiles(sha: string, parent: string | null): Promise<FileChange[]> {
    assertArgument(sha);
    if (parent !== null) assertArgument(parent);
    const args = [
      '-r',
      '-z',
      '--name-status',
      '-M',
      '--no-commit-id',
      ...(parent !== null ? [parent, sha] : ['--root', sha]),
    ];
    return parseNameStatus((await this.runner.run('diff-tree', args)).stdout);
  }

  /** Message plus changed files of one commit. */
  async commitDetails(commit: Commit): Promise<CommitDetails> {
    const [message, files] = await Promise.all([
      this.commitMessage(commit.id),
      this.changedFiles(commit.id, commit.parents[0] ?? null),
    ]);
    return { commit, message, files };
  }

  /**
   * Unified diff of one file in a commit (raw BYTES — hand them to `diff/` for parsing). `ignoreWhitespace`: drop
   * whitespace-only changes (`--ignore-all-space`, GitKraken's "Ignore whitespace").
   */
  async commitDiffBytes(
    sha: string,
    parent: string | null,
    file: FileChange,
    context = 3,
    ignoreWhitespace = false,
  ): Promise<Uint8Array> {
    assertArgument(sha);
    if (parent !== null) assertArgument(parent);
    assertContext(context);
    const args = [
      '-p',
      '-M',
      '--no-color',
      `-U${context}`,
      ...(ignoreWhitespace ? ['--ignore-all-space'] : []),
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--no-commit-id',
      ...(parent !== null ? [parent, sha] : ['--root', sha]),
      '--',
      ...fileChangeAllPaths(file),
    ];
    return (await this.runner.run('diff-tree', args, { env: LITERAL_PATHSPECS })).stdout;
  }

  /**
   * Diff of one file in the working tree / index (raw bytes). `untracked` compares against /dev/null (git exits 1 when they
   * differ). `ignoreWhitespace`: the diff is for VIEWING only — a patch built from it cannot be reapplied (per-line
   * staging is unavailable while it is on).
   */
  async workingDiffBytes(
    change: FileChange,
    kind: WorkingDiffKind,
    context = 3,
    ignoreWhitespace = false,
  ): Promise<Uint8Array> {
    assertContext(context);
    const common = [
      '--no-color',
      `-U${context}`,
      ...(ignoreWhitespace && kind !== 'untracked' ? ['--ignore-all-space'] : []),
      '--src-prefix=a/',
      '--dst-prefix=b/',
    ];
    switch (kind) {
      case 'unstaged':
        return (await this.runner.run('diff', [...common, '--', change.path], { env: DIFF_ENV })).stdout;
      case 'staged':
        return (
          await this.runner.run('diff', ['--cached', '-M', ...common, '--', ...fileChangeAllPaths(change)], {
            env: DIFF_ENV,
          })
        ).stdout;
      case 'untracked':
        return (
          await this.runner.run('diff', ['--no-index', ...common, '--', '/dev/null', change.path], {
            acceptExitCodes: [0, 1],
          })
        ).stdout;
    }
  }

  /** Every staged change (raw bytes) — context for AI commit messages. */
  async stagedDiffBytes(context = 3): Promise<Uint8Array> {
    assertContext(context);
    const args = ['--cached', '-M', '--no-color', `-U${context}`, '--src-prefix=a/', '--dst-prefix=b/'];
    return (await this.runner.run('diff', args, { env: DIFF_ENV })).stdout;
  }

  /** Full diff of a commit against its first parent (a root commit against the empty tree). */
  async commitPatchBytes(sha: string, parent: string | null, context = 3): Promise<Uint8Array> {
    assertArgument(sha);
    if (parent !== null) assertArgument(parent);
    assertContext(context);
    const args = [
      '-p',
      '-M',
      '--no-color',
      `-U${context}`,
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--no-commit-id',
      ...(parent !== null ? [parent, sha] : ['--root', sha]),
    ];
    return (await this.runner.run('diff-tree', args)).stdout;
  }

  /** Diff of branch `head` against its divergence point from `base` (`base...head`) — context for a pull request description. */
  async branchDiffBytes(base: string, head: string, context = 3): Promise<Uint8Array> {
    assertArgument(base);
    assertArgument(head);
    assertContext(context);
    const args = [
      '-M',
      '--no-color',
      `-U${context}`,
      '--src-prefix=a/',
      '--dst-prefix=b/',
      `${base}...${head}`,
      '--',
    ];
    return (await this.runner.run('diff', args, { env: DIFF_ENV })).stdout;
  }

  /** Subjects of recent commits on `rev` (newest first); a repo with no commits → []. */
  async recentSubjects(limit = 10, rev = 'HEAD', excludeRev: string | null = null): Promise<string[]> {
    assertArgument(rev);
    if (excludeRev !== null) assertArgument(excludeRev);
    const range = excludeRev === null ? [rev] : [`${excludeRev}..${rev}`];
    try {
      const output = await this.runner.text('log', [
        '-z',
        '--no-merges',
        '--format=%s',
        `--max-count=${Math.max(1, Math.trunc(limit))}`,
        ...range,
        '--',
      ]);
      return output.split('\0').filter((subject) => subject.trim() !== '');
    } catch (error) {
      if (
        error instanceof GitError &&
        (error.contains('does not have any commits') || error.contains('bad revision'))
      ) {
        return [];
      }
      throw error;
    }
  }

  /** Blob content, e.g. "HEAD:path", ":path" (index), "<sha>:path". */
  async blob(spec: string): Promise<Uint8Array> {
    assertArgument(spec);
    return (await this.runner.run('cat-file', ['blob', spec])).stdout;
  }

  /** Bytes of a file in the working tree (null when absent). Goes through `RepoFs`, so it is confined to the repo. */
  async workingFileBytes(path: string, maxBytes?: number): Promise<Uint8Array | null> {
    return this.fs.readWorktreeFile(path, maxBytes);
  }

  /** Commits touching `path` (newest first), following renames; each entry carries that file at that commit. */
  async fileHistory(path: string, limit = 300): Promise<FileHistoryEntry[]> {
    assertNoNul(path);
    const out = await this.runner.run(
      'log',
      [
        '-z',
        `--format=${FILE_HISTORY_FORMAT}`,
        '--follow',
        '--name-status',
        `--max-count=${Math.max(1, Math.trunc(limit))}`,
        '--',
        path,
      ],
      { env: LITERAL_PATHSPECS },
    );
    return parseFileHistory(out.stdout, path);
  }

  /**
   * Blame `path` at `rev` (null: the working-tree version, including uncommitted lines). `-M`: lines moved within a file still
   * count towards their original commit (`-C` is deliberately not used: the policy rejects that short flag).
   * `--no-textconv` is inserted by the policy when running git.
   */
  async blame(path: string, rev: string | null = null): Promise<Blame> {
    assertNoNul(path);
    if (rev !== null) assertArgument(rev);
    const out = await this.runner.run(
      'blame',
      ['--porcelain', '-M', ...(rev !== null ? [rev] : []), '--', path],
      { env: DIFF_ENV },
    );
    return parseBlame(out.stdout);
  }

  async resolveCommit(rev: string): Promise<string> {
    assertArgument(rev);
    return (await this.runner.text('rev-parse', ['--verify', '--quiet', `${rev}^{commit}`])).trim();
  }

  /**
   * Nearest common ancestor commit of `a` and `b` (where a branch diverged from its target — the marker for a pull
   * request's "Files changed"). Null when the two share no history (git exits 1).
   */
  async mergeBase(a: string, b: string): Promise<string | null> {
    assertArgument(a);
    assertArgument(b);
    const out = await this.runner.run('merge-base', [a, b], { acceptExitCodes: [0, 1] });
    return out.code === 0 ? decodeUtf8(out.stdout).trim() || null : null;
  }

  /** Config value (null when unset). Exit code 1 from `git config --get` means unset; other errors still throw. */
  async config(key: string): Promise<string | null> {
    assertArgument(key);
    const out = await this.runner.run('config', ['--get', key], { acceptExitCodes: [0, 1] });
    if (out.code !== 0) return null;
    const value = decodeUtf8(out.stdout).trim();
    return value === '' ? null : value;
  }

  /** Set a config value (only keys in the policy's allowlist; enforced by the typed adapter). */
  async setConfig(key: string, value: string, scope: 'local' | 'global'): Promise<void> {
    await this.requireTyped().configSet(key, value, scope);
  }

  /** Ask git whether a branch/tag name is valid (the source of truth). Names starting with `-` are always rejected. */
  async isValidRefName(name: string, branch: boolean): Promise<boolean> {
    if (name === '' || name.startsWith('-') || /[\0\r\n]/.test(name)) return false;
    try {
      await this.runner.run('check-ref-format', branch ? ['--branch', name] : [`refs/tags/${name}`]);
      return true;
    } catch (error) {
      if (error instanceof GitError) return false;
      throw error;
    }
  }

  // MARK: - In-progress operations

  /** Unfinished merge/rebase/cherry-pick/revert/am/bisect, read from files in the git dir through `RepoFs.readGitFile`. */
  async operationState(): Promise<RepoOperation | null> {
    const read = (name: string) => this.fs.readGitFile(name);
    const [rebaseMerge, amApplying, rebaseApply, mergeHead, cherryPickHead, revertHead, bisectLog] =
      await Promise.all([
        read('rebase-merge/head-name'),
        read('rebase-apply/applying'),
        read('rebase-apply/head-name'),
        read('MERGE_HEAD'),
        read('CHERRY_PICK_HEAD'),
        read('REVERT_HEAD'),
        read('BISECT_LOG'),
      ]);
    const headNameOf = (bytes: Uint8Array): string => {
      const value = decodeUtf8(bytes).trim();
      return value.startsWith('refs/heads/') ? value.slice('refs/heads/'.length) : value;
    };
    const readInt = async (name: string) => {
      const bytes = await read(name);
      return bytes === null ? null : parseOptionalInt(decodeUtf8(bytes));
    };
    if (rebaseMerge !== null) {
      const [step, total] = await Promise.all([readInt('rebase-merge/msgnum'), readInt('rebase-merge/end')]);
      return { kind: 'rebasing', step, total, headName: headNameOf(rebaseMerge) };
    }
    if (amApplying !== null) return { kind: 'applyingPatches' };
    if (rebaseApply !== null) {
      const [step, total] = await Promise.all([readInt('rebase-apply/next'), readInt('rebase-apply/last')]);
      return { kind: 'rebasing', step, total, headName: headNameOf(rebaseApply) };
    }
    if (mergeHead !== null) return { kind: 'merging' };
    if (cherryPickHead !== null) return { kind: 'cherryPicking' };
    if (revertHead !== null) return { kind: 'reverting' };
    if (bisectLog !== null) return { kind: 'bisecting' };
    return null;
  }

  /** Suggested message while merging (MERGE_MSG/SQUASH_MSG), with the `#` comment lines removed. */
  async pendingCommitMessage(): Promise<string | null> {
    for (const name of ['MERGE_MSG', 'SQUASH_MSG']) {
      const bytes = await this.fs.readGitFile(name);
      if (bytes === null) continue;
      const message = decodeUtf8(bytes)
        .split('\n')
        .filter((line) => !line.startsWith('#'))
        .join('\n')
        .trim();
      if (message !== '') return message;
    }
    return null;
  }

  // MARK: - Stage / unstage / discard

  async stage(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.runner.run('add', ['-A', '--pathspec-from-file=-', '--pathspec-file-nul'], {
      stdin: nulSeparated(paths),
      env: LITERAL_PATHSPECS,
    });
  }

  async stageAll(): Promise<void> {
    await this.runner.run('add', ['-A']);
  }

  async unstage(paths: readonly string[], headExists: boolean): Promise<void> {
    if (paths.length === 0) return;
    const stdin = nulSeparated(paths);
    if (headExists) {
      await this.runner.run('reset', ['-q', '--pathspec-from-file=-', '--pathspec-file-nul', 'HEAD'], {
        stdin,
        env: LITERAL_PATHSPECS,
      });
    } else {
      await this.runner.run('rm', ['--cached', '-r', '-q', '--pathspec-from-file=-', '--pathspec-file-nul'], {
        stdin,
        env: LITERAL_PATHSPECS,
      });
    }
  }

  async unstageAll(headExists: boolean): Promise<void> {
    // Reset carries a pathspec so it does not clear an in-progress merge.
    if (headExists) await this.runner.run('reset', ['-q', 'HEAD', '--', '.']);
    else await this.runner.run('rm', ['--cached', '-r', '-q', '--', '.']);
  }

  /** Discard the unstaged changes of a tracked file (restored from the index). */
  async discard(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.runner.run('restore', ['--worktree', '--pathspec-from-file=-', '--pathspec-file-nul'], {
      stdin: nulSeparated(paths),
      env: LITERAL_PATHSPECS,
    });
  }

  /** Move an untracked file into the app's trash (`<commonDir>/thaigit/trash/…`) and return a token for `restoreTrash`. */
  async trashUntracked(paths: readonly string[]): Promise<string> {
    return this.fs.trashUntracked(paths);
  }

  async restoreTrash(token: string): Promise<void> {
    await this.fs.restoreTrash(token);
  }

  /**
   * Snapshot every tracked change (index + working tree) as a dangling stash commit without touching the working tree —
   * used to offer "Undo" after a discard. No changes → null.
   */
  async snapshotChanges(): Promise<string | null> {
    const sha = (await this.runner.text('stash', ['create'])).trim();
    return sha === '' ? null : sha;
  }

  /** Restore the working-tree content of files from a commit (the index is untouched). */
  async restoreWorkingFiles(rev: string, paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    assertArgument(rev);
    await this.runner.run(
      'restore',
      [`--source=${rev}`, '--worktree', '--pathspec-from-file=-', '--pathspec-file-nul'],
      {
        stdin: nulSeparated(paths),
        env: LITERAL_PATHSPECS,
      },
    );
  }

  /** Write bytes into the object store (`hash-object -w --stdin`) and return the SHA — e.g. to capture a file's content before discarding it. */
  async hashObject(content: Uint8Array): Promise<string> {
    return (await this.runner.text('hash-object', ['-w', '--stdin'], { stdin: content })).trim();
  }

  /** Apply a byte patch (from `diff/patch-builder`) to the index (`cached`) or the working tree; `reverse` for unstage/discard; `unidiffZero` for `-U0` patches. */
  async applyPatch(patch: Uint8Array, options: ApplyPatchOptions): Promise<void> {
    const args = ['--whitespace=nowarn', '--recount'];
    if (options.unidiffZero) args.push('--unidiff-zero');
    if (options.cached) args.push('--cached');
    if (options.reverse) args.push('--reverse');
    args.push('-');
    await this.runner.run('apply', args, { stdin: patch });
  }

  async hardReset(rev = 'HEAD'): Promise<void> {
    assertArgument(rev);
    await this.runner.run('reset', ['--hard', '-q', rev]);
  }

  async addToGitignore(pattern: string): Promise<void> {
    await this.fs.appendGitignore(pattern);
  }

  // MARK: - Commit

  async commit(message: string, options: CommitOptions = {}): Promise<void> {
    const args = ['--cleanup=whitespace', '-F', '-'];
    if (options.amend) args.push('--amend');
    if (options.allowEmpty) args.push('--allow-empty');
    await this.runner.run('commit', args, { stdin: encodeUtf8(message) });
  }

  /** Move the current branch to `rev`, keeping changes (used to undo a commit). */
  async softReset(rev: string): Promise<void> {
    assertArgument(rev);
    await this.runner.run('reset', ['--soft', rev]);
  }

  /** Drop the branch's first commit (the branch returns to the no-commits state); the index is kept. */
  async undoInitialCommit(): Promise<void> {
    await this.runner.run('update-ref', ['-d', 'HEAD']);
  }

  // MARK: - Branches

  async switchTo(branch: string): Promise<void> {
    assertArgument(branch);
    await this.runner.run('switch', ['--no-guess', branch]);
  }

  async switchDetached(rev: string): Promise<void> {
    assertArgument(rev);
    await this.runner.run('switch', ['--detach', rev]);
  }

  async createBranch(name: string, startPoint: string | null, checkout: boolean): Promise<void> {
    assertArgument(name);
    if (startPoint !== null) assertArgument(startPoint);
    const start = startPoint === null ? [] : [startPoint];
    if (checkout) await this.runner.run('switch', ['-c', name, ...start]);
    else await this.runner.run('branch', [name, ...start]);
  }

  /** Create a local branch tracking a remote branch, then check it out. */
  async checkoutTracking(remoteBranch: string, localName: string): Promise<void> {
    assertArgument(remoteBranch);
    assertArgument(localName);
    await this.runner.run('switch', ['-c', localName, '--track', remoteBranch]);
  }

  async deleteBranch(name: string, force: boolean): Promise<void> {
    assertArgument(name);
    await this.runner.run('branch', [force ? '-D' : '-d', name]);
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    assertArgument(oldName);
    assertArgument(newName);
    await this.runner.run('branch', ['-m', oldName, newName]);
  }

  async setUpstream(branch: string, upstream: string): Promise<void> {
    assertArgument(branch);
    assertArgument(upstream);
    await this.runner.run('branch', [`--set-upstream-to=${upstream}`, branch]);
  }

  async unsetUpstream(branch: string): Promise<void> {
    assertArgument(branch);
    await this.runner.run('branch', ['--unset-upstream', branch]);
  }

  /** Point a ref at a specific object (used to restore a deleted branch/tag). */
  async updateRef(fullName: string, object: string): Promise<void> {
    assertArgument(fullName);
    assertArgument(object);
    await this.runner.run('update-ref', [fullName, object]);
  }

  /** Fast-forward a branch that is not the current one to its upstream. */
  async fastForward(branch: string, upstream: string): Promise<void> {
    assertRefspecName(branch, true);
    assertArgument(upstream);
    if (upstream.includes(':')) throw new RepositoryError('invalidName', upstream);
    await this.runner.run('fetch', ['.', `${upstream}:refs/heads/${branch}`]);
  }

  // MARK: - Merge / rebase / cherry-pick / revert / reset

  async merge(ref: string, style: MergeStyle = 'automatic'): Promise<void> {
    assertArgument(ref);
    const args = ['--no-edit'];
    if (style === 'noFastForward') args.push('--no-ff');
    else if (style === 'fastForwardOnly') args.push('--ff-only');
    else if (style === 'squash') args.push('--squash');
    args.push(ref);
    await this.runner.run('merge', args);
  }

  /** Rebase branch `branch` (default: current) onto `ref`. With `branch`, git checks that branch out first. */
  async rebase(onto: string, branch: string | null = null): Promise<void> {
    assertArgument(onto);
    if (branch !== null) assertArgument(branch);
    await this.runner.run('rebase', branch === null ? [onto] : [onto, branch]);
  }

  /**
   * Commits an interactive rebase from `base` to HEAD would rewrite, oldest first. Null when `base` is not in HEAD's
   * history (nothing can be rebased onto it).
   */
  async rebaseCommits(base: string): Promise<Commit[] | null> {
    assertArgument(base);
    const ancestor = await this.runner.run('merge-base', ['--is-ancestor', base, 'HEAD'], {
      acceptExitCodes: [0, 1],
    });
    if (ancestor.code !== 0) return null;
    const out = await this.runner.run('log', [
      '-z',
      `--format=${LOG_FORMAT}`,
      '--reverse',
      '--topo-order',
      `${base}..HEAD`,
      '--',
    ]);
    return parseLog(out.stdout);
  }

  /**
   * Interactive rebase of the current branch onto `onto` (full sha) following the plan (oldest → newest). Uncommitted
   * changes are auto-stashed and re-applied. Git stopping part-way (a conflict…) raises `GitError`, like a normal rebase
   * (Continue / Skip / Abort).
   */
  async interactiveRebase(onto: string, steps: readonly RebaseStep[]): Promise<InteractiveRebaseResult> {
    assertArgument(onto);
    const startedAt = Date.now();
    const result = await this.requireTyped().rebaseInteractive(onto, rebaseRequest(steps));
    const args = ['rebase', '-i', '--autostash', '--no-autosquash', onto];
    this.runner.log?.record({
      args,
      startedAt,
      durationMs: Date.now() - startedAt,
      exitCode: result.exitCode,
      cancelled: false,
      stderr: result.stderr,
    });
    if (result.exitCode !== 0) throw new GitError(args, result.exitCode, result.stdout, result.stderr);
    return /autostash/i.test(result.stderr + result.stdout) && /conflict/i.test(result.stderr + result.stdout)
      ? 'autostashConflict'
      : 'done';
  }

  async cherryPick(sha: string, mainline: number | null = null): Promise<void> {
    assertArgument(sha);
    await this.runner.run('cherry-pick', [...this.mainlineArgs(mainline), sha]);
  }

  /**
   * Create a commit reverting `sha`. `commit: false` (`--no-commit`) only stages the revert for review or editing: git
   * leaves REVERT_HEAD behind, so the repo stays in the "Reverting" state until the commit (or an `abort`).
   */
  async revert(sha: string, mainline: number | null = null, commit = true): Promise<void> {
    assertArgument(sha);
    await this.runner.run('revert', [
      commit ? '--no-edit' : '--no-commit',
      ...this.mainlineArgs(mainline),
      sha,
    ]);
  }

  private mainlineArgs(mainline: number | null): string[] {
    if (mainline === null) return [];
    if (!Number.isInteger(mainline) || mainline < 1)
      throw new RangeError(`Số cha (mainline) không hợp lệ: ${mainline}`);
    return ['-m', String(mainline)];
  }

  async reset(rev: string, mode: ResetMode): Promise<void> {
    assertArgument(rev);
    await this.runner.run('reset', ['-q', `--${mode}`, rev]);
  }

  /** Undo a just-finished merge/rebase while keeping uncommitted local changes. */
  async resetKeepingLocalChanges(rev: string): Promise<void> {
    assertArgument(rev);
    await this.runner.run('reset', ['-q', '--merge', rev]);
  }

  async abort(operation: RepoOperation): Promise<void> {
    if (operation.kind === 'bisecting') await this.runner.run('bisect', ['reset']);
    else await this.runner.run(OPERATION_SUBCOMMAND[operation.kind], ['--abort']);
  }

  async continueOperation(operation: RepoOperation): Promise<void> {
    if (operation.kind === 'bisecting') return;
    await this.runner.run(OPERATION_SUBCOMMAND[operation.kind], ['--continue']);
  }

  async skip(operation: RepoOperation): Promise<void> {
    if (operation.kind === 'merging' || operation.kind === 'bisecting') return;
    await this.runner.run(OPERATION_SUBCOMMAND[operation.kind], ['--skip']);
  }

  // MARK: - Conflicts

  /** Resolve a conflict by taking one side wholesale. */
  async resolveConflict(path: string, kind: ConflictKind, useOurs: boolean): Promise<void> {
    assertNoNul(path);
    const sideMissing = useOurs
      ? kind === 'deletedByUs' || kind === 'bothDeleted' || kind === 'addedByThem'
      : kind === 'deletedByThem' || kind === 'bothDeleted' || kind === 'addedByUs';
    if (sideMissing) {
      await this.runner.run('rm', ['-q', '--', path], { env: LITERAL_PATHSPECS });
    } else {
      await this.runner.run('checkout', [useOurs ? '--ours' : '--theirs', '--', path], {
        env: LITERAL_PATHSPECS,
      });
      await this.runner.run('add', ['--', path], { env: LITERAL_PATHSPECS });
    }
  }

  async markResolved(paths: readonly string[]): Promise<void> {
    await this.stage(paths);
  }

  /** Bytes of the conflicted file in the working tree (null when absent). */
  async readWorkingFile(path: string, maxBytes?: number): Promise<Uint8Array | null> {
    return this.fs.readWorktreeFile(path, maxBytes);
  }

  /** Write a working-tree file (compare-and-set against the SHA-256 of the content that was read; `null` = the file must not exist). */
  async writeWorkingFile(path: string, bytes: Uint8Array, expectedSha256: string | null): Promise<void> {
    await this.fs.writeWorktreeFile(path, bytes, expectedSha256);
  }

  // MARK: - Remotes

  async fetch(options: FetchOptions = {}): Promise<void> {
    const args = ['--progress'];
    if (options.prune) args.push('--prune');
    if (options.remote !== undefined && options.remote !== null) {
      assertArgument(options.remote);
      args.push(options.remote);
    } else {
      args.push('--all');
    }
    await this.runner.run('fetch', args, networkRunOptions(options));
  }

  /** See `HistoryGaps`. Read-only (rev-parse + config) and cheap, so it is re-read whenever refs change. */
  async historyGaps(): Promise<HistoryGaps> {
    const [shallow, refspecs, remotes] = await Promise.all([
      // A git too old to know this flag echoes the flag back verbatim → not "true" → treat history as complete.
      this.runner.text('rev-parse', ['--is-shallow-repository']).then((out) => out.trim() === 'true'),
      this.runner
        .text('config', ['-z', '--get-regexp', '^remote\\..+\\.fetch$'])
        .then(parseFetchRefspecs)
        .catch((error: unknown) => {
          // No matching key: git exits 1.
          if (error instanceof GitError) return new Map<string, string[]>();
          throw error;
        }),
      this.remotes(),
    ]);
    const narrowRemotes = remotes
      .map((remote) => remote.name)
      .filter((name) => {
        const specs = refspecs.get(name) ?? [];
        return specs.length > 0 && !tracksAllBranches(specs);
      });
    return { shallow, narrowRemotes };
  }

  /** Make `remote` track every branch: ADD `+refs/heads/*:refs/remotes/<remote>/*`, keeping the old refspec (`remote set-branches --add`). */
  async trackAllBranches(remote: string): Promise<void> {
    assertArgument(remote);
    await this.runner.run('remote', ['set-branches', '--add', remote, '*']);
  }

  /**
   * Fetch one specific refspec (e.g. `+refs/pull/42/head:refs/remotes/origin/pr/42` when checking out a pull request). The
   * refspec is checked for non-whitespace and no leading `-` before going into the git command.
   */
  async fetchRefspec(
    remote: string,
    refspec: string | readonly string[],
    options: NetworkOptions = {},
  ): Promise<void> {
    assertArgument(remote);
    const refspecs = typeof refspec === 'string' ? [refspec] : refspec;
    for (const item of refspecs) assertArgument(item);
    await this.runner.run('fetch', ['--progress', remote, ...refspecs], networkRunOptions(options));
  }

  /** Fetch the missing history of a shallow clone from `remote` (`fetch --unshallow`). */
  async unshallow(remote: string, options: NetworkOptions = {}): Promise<void> {
    assertArgument(remote);
    await this.runner.run('fetch', ['--progress', '--unshallow', remote], networkRunOptions(options));
  }

  /**
   * Pull = `fetch` (network, cancellable) then integrate with `merge`/`rebase` (a write, NOT cancellable — killing git
   * mid-write leaves an orphaned `index.lock` or a half-done rebase). The current branch must have an upstream.
   */
  async pull(mode: PullMode, options: NetworkOptions = {}): Promise<void> {
    // With no upstream, throw git's own error ("no upstream configured for branch …") rather than fetching pointlessly.
    const upstream = (await this.runner.text('rev-parse', ['--symbolic-full-name', '@{upstream}'])).trim();
    await this.runner.run('fetch', ['--progress'], networkRunOptions(options));
    switch (mode) {
      case 'merge':
        await this.runner.run('merge', ['--no-edit', upstream]);
        break;
      case 'fastForwardOnly':
        await this.runner.run('merge', ['--ff-only', upstream]);
        break;
      case 'rebase':
        // `--fork-point` as in `git pull --rebase`: skip local commits that upstream already rewrote.
        await this.runner.run('rebase', ['--fork-point', upstream]);
        break;
    }
  }

  async push(options: PushOptions): Promise<void> {
    assertArgument(options.remote);
    assertRefspecName(options.localBranch, true);
    assertRefspecName(options.remoteBranch, true);
    const args = ['--progress'];
    if (options.setUpstream) args.push('--set-upstream');
    if (options.force) args.push('--force-with-lease');
    args.push(options.remote, `refs/heads/${options.localBranch}:refs/heads/${options.remoteBranch}`);
    await this.runner.run('push', args, networkRunOptions(options));
  }

  /** Push an arbitrary commit to a branch on the remote (used to restore a just-deleted remote branch). */
  async pushCommit(sha: string, remote: string, branch: string, options: NetworkOptions = {}): Promise<void> {
    assertArgument(remote);
    if (!/^[0-9a-fA-F]{4,64}$/.test(sha)) throw new RepositoryError('invalidName', sha);
    assertRefspecName(branch, true);
    await this.runner.run(
      'push',
      ['--progress', remote, `${sha}:refs/heads/${branch}`],
      networkRunOptions(options),
    );
  }

  async deleteRemoteBranch(remote: string, branch: string, options: NetworkOptions = {}): Promise<void> {
    assertArgument(remote);
    assertRefspecName(branch, true);
    await this.runner.run(
      'push',
      ['--progress', remote, '--delete', `refs/heads/${branch}`],
      networkRunOptions(options),
    );
  }

  async pushTag(remote: string, tag: string, options: NetworkOptions = {}): Promise<void> {
    assertArgument(remote);
    assertRefspecName(tag, false);
    await this.runner.run('push', ['--progress', remote, `refs/tags/${tag}`], networkRunOptions(options));
  }

  async pushAllTags(remote: string, options: NetworkOptions = {}): Promise<void> {
    assertArgument(remote);
    await this.runner.run('push', ['--progress', remote, '--tags'], networkRunOptions(options));
  }

  async deleteRemoteTag(remote: string, tag: string, options: NetworkOptions = {}): Promise<void> {
    assertArgument(remote);
    assertRefspecName(tag, false);
    await this.runner.run('push', [remote, '--delete', `refs/tags/${tag}`], networkRunOptions(options));
  }

  /** Add a remote (typed command: the adapter validates the URL). */
  async addRemote(name: string, url: string): Promise<void> {
    assertArgument(name);
    await this.requireTyped().remoteAdd(name, url);
  }

  async setRemoteUrl(name: string, url: string): Promise<void> {
    assertArgument(name);
    await this.requireTyped().remoteSetUrl(name, url);
  }

  async removeRemote(name: string): Promise<void> {
    assertArgument(name);
    await this.runner.run('remote', ['remove', name]);
  }

  /** Rename a remote: git also renames the remote branches (`refs/remotes/<old>/…`) and the upstreams of local branches tracking them. */
  async renameRemote(oldName: string, newName: string): Promise<void> {
    assertArgument(oldName);
    if (!isValidRemoteName(newName)) throw new RepositoryError('invalidName', newName);
    await this.runner.run('remote', ['rename', oldName, newName]);
  }

  // MARK: - Worktrees, submodules

  async worktrees(): Promise<Worktree[]> {
    const out = await this.runner.run('worktree', ['list', '--porcelain', '-z']);
    return parseWorktrees(out.stdout);
  }

  /** Add a worktree (typed command: the destination folder comes from a native dialog). Returns the new worktree path. */
  async addWorktree(
    destToken: string,
    name: string,
    branch: string,
    createBranch: boolean,
    start: string | null = null,
  ): Promise<string> {
    assertArgument(branch);
    if (start !== null) assertArgument(start);
    return this.requireTyped().worktreeAdd(destToken, name, branch, createBranch, start);
  }

  /** Remove a worktree (`force`: even with uncommitted changes — which are then lost). */
  async removeWorktree(path: string, force: boolean): Promise<void> {
    assertArgument(path);
    await this.runner.run('worktree', ['remove', ...(force ? ['--force'] : []), path]);
  }

  /** Prune bookkeeping of worktrees whose directory is gone. */
  async pruneWorktrees(): Promise<void> {
    await this.runner.run('worktree', ['prune']);
  }

  /** Submodules; a repo without `.gitmodules` returns empty without running git. */
  async submodules(): Promise<Submodule[]> {
    // A file too large for the read limit still counts as `.gitmodules` → go ahead and ask git.
    const exists = await this.fs.readWorktreeFile('.gitmodules', 1024 * 1024).then(
      (bytes) => bytes !== null,
      () => true,
    );
    if (!exists) return [];
    const out = await this.runner.run('submodule', ['status']);
    return parseSubmoduleStatus(out.stdout);
  }

  /** `submodule update --init --recursive` for `paths` (null = all). */
  async updateSubmodules(paths: readonly string[] | null): Promise<void> {
    const args = ['update', '--init', '--recursive'];
    if (paths !== null) {
      for (const path of paths) assertNoNul(path);
      args.push('--', ...paths);
    }
    await this.runner.run('submodule', args, { env: LITERAL_PATHSPECS });
  }

  /** Copy submodule URLs from `.gitmodules` back into config (after a submodule's remote changed address). */
  async syncSubmodules(): Promise<void> {
    await this.runner.run('submodule', ['sync', '--recursive']);
  }

  // MARK: - Git LFS

  /** git-lfs version (`git-lfs/3.4.1 (…)` → `3.4.1`); null = Git LFS is not installed. */
  async lfsVersion(): Promise<string | null> {
    try {
      const out = await this.runner.run('lfs', ['version']);
      return /^git-lfs\/(\S+)/.exec(decodeUtf8(out.stdout).trim())?.[1] ?? null;
    } catch (error) {
      if (error instanceof GitError) return null;
      throw error;
    }
  }

  /** LFS patterns from the repo root's `.gitattributes` — reads the file, no git-lfs needed. */
  async lfsPatterns(): Promise<LfsPattern[]> {
    const bytes = await this.fs.readWorktreeFile('.gitattributes', 1024 * 1024).catch(() => null);
    return bytes === null ? [] : parseLfsPatterns(decodeUtf8(bytes));
  }

  /** Add a pattern to `.gitattributes` (`git lfs track`); a changed file is not staged yet. */
  async lfsTrack(pattern: string): Promise<void> {
    assertNoNul(pattern);
    await this.runner.run('lfs', ['track', '--', pattern]);
  }

  async lfsUntrack(pattern: string): Promise<void> {
    assertNoNul(pattern);
    await this.runner.run('lfs', ['untrack', '--', pattern]);
  }

  /** Download the current branch's LFS files into the cache (`pull`: also replaces the pointer in the working tree with the real file). */
  async lfsFetch(pull: boolean, options: NetworkOptions = {}): Promise<void> {
    await this.runner.run('lfs', [pull ? 'pull' : 'fetch'], networkRunOptions(options));
  }

  /** Upload branch `branch`'s LFS files to `remote` — runs before `git push` because git-lfs's pre-push hook may not run. */
  async lfsPush(remote: string, branch: string, options: NetworkOptions = {}): Promise<void> {
    assertArgument(remote);
    assertArgument(branch);
    await this.runner.run('lfs', ['push', remote, branch], networkRunOptions(options));
  }

  /** Prune old LFS copies from the local cache (only those present on the remote and no longer used by a recent commit). */
  async lfsPrune(): Promise<void> {
    await this.runner.run('lfs', ['prune']);
  }

  // MARK: - Stash

  async stashPush(message: string | null, includeUntracked: boolean): Promise<void> {
    const args = ['push'];
    if (includeUntracked) args.push('--include-untracked');
    if (message !== null && message !== '') {
      assertNoNul(message);
      args.push(`--message=${message}`);
    }
    await this.runner.run('stash', args);
  }

  async stashApply(selector: string, restoreIndex = false): Promise<void> {
    assertArgument(selector);
    await this.runner.run('stash', ['apply', ...(restoreIndex ? ['--index'] : []), selector]);
  }

  async stashPop(selector: string): Promise<void> {
    assertArgument(selector);
    await this.runner.run('stash', ['pop', selector]);
  }

  async stashDrop(selector: string): Promise<void> {
    assertArgument(selector);
    await this.runner.run('stash', ['drop', selector]);
  }

  /** Put a stash commit back into the stash list (undoing "delete stash"). */
  async stashStore(sha: string, message: string): Promise<void> {
    assertArgument(sha);
    assertNoNul(message);
    await this.runner.run('stash', ['store', `--message=${message}`, sha]);
  }

  /** Files in a stash: tracked changes (against the HEAD at stash time) plus untracked files (third parent). */
  async stashFiles(stash: Stash): Promise<FileChange[]> {
    const files = await this.changedFiles(stash.sha, stash.parents[0] ?? null);
    const untrackedParent = stash.parents[2];
    if (untrackedParent === undefined) return files;
    const untracked = await this.changedFiles(untrackedParent, null);
    return [...files, ...untracked.map((file) => fileChange(file.path, 'untracked'))];
  }

  /** Diff of one file in a stash (raw bytes). An untracked file lives in the stash commit's third parent. */
  async stashDiffBytes(
    stash: Stash,
    file: FileChange,
    context = 3,
    ignoreWhitespace = false,
  ): Promise<Uint8Array> {
    const untrackedParent = stash.parents[2];
    if (file.kind === 'untracked' && untrackedParent !== undefined)
      return this.commitDiffBytes(untrackedParent, null, file, context, ignoreWhitespace);
    return this.commitDiffBytes(stash.sha, stash.parents[0] ?? null, file, context, ignoreWhitespace);
  }

  // MARK: - Tags

  async createTag(name: string, rev: string, message: string | null): Promise<void> {
    assertArgument(name);
    assertArgument(rev);
    if (message !== null && message.trim() !== '') {
      assertNoNul(message);
      await this.runner.run('tag', ['-a', name, `--message=${message}`, rev]);
    } else {
      await this.runner.run('tag', [name, rev]);
    }
  }

  async deleteTag(name: string): Promise<void> {
    assertArgument(name);
    await this.runner.run('tag', ['-d', name]);
  }

  // MARK: - Internals

  private requireTyped(): TypedGit {
    if (!this.typed)
      throw new AdapterError(
        'internal',
        'Chưa cấu hình bộ chuyển cho lệnh có kiểu (config set, remote add/set-url).',
      );
    return this.typed;
  }
}

function networkRunOptions(options: NetworkOptions): {
  onProgress?: (line: string) => void;
  signal?: AbortSignal;
  profile?: EnvProfile;
} {
  return { onProgress: options.onProgress, signal: options.signal, profile: options.profile };
}
