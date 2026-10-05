// Git data models (port of Models.swift). Everything is a plain object (JSON/structured-clone safe, so it crosses a
// Web Worker without losing prototypes) with pure functions for the parts Swift wrote as computed properties. Times are
// UNIX SECONDS (number).

import { gitBasename, gitDirname } from '../support/paths.ts';

// MARK: - Commit

export interface Commit {
  readonly id: string;
  readonly parents: readonly string[];
  readonly authorName: string;
  readonly authorEmail: string;
  /** Unix seconds. */
  readonly authorDate: number;
  readonly committerName: string;
  readonly committerEmail: string;
  /** Unix seconds. */
  readonly commitDate: number;
  readonly subject: string;
}

/** Synthetic commit standing in for uncommitted changes (the "WIP" node on the graph). */
export const WORKING_TREE_ID = '__THAIGIT_WORKING_TREE__';

export function shortSha(commit: Pick<Commit, 'id'>): string {
  return commit.id.slice(0, 7);
}

export function isMergeCommit(commit: Pick<Commit, 'parents'>): boolean {
  return commit.parents.length > 1;
}

export function isWorkingTreeCommit(commit: Pick<Commit, 'id'>): boolean {
  return commit.id === WORKING_TREE_ID;
}

export function workingTreeCommit(parent: string | null, nowSeconds = Math.floor(Date.now() / 1000)): Commit {
  return {
    id: WORKING_TREE_ID,
    parents: parent === null ? [] : [parent],
    authorName: '',
    authorEmail: '',
    authorDate: nowSeconds,
    committerName: '',
    committerEmail: '',
    commitDate: nowSeconds,
    subject: '',
  };
}

// MARK: - Ref

export type RefKind = 'localBranch' | 'remoteBranch' | 'tag';

export interface GitRef {
  readonly fullName: string;
  readonly kind: RefKind;
  /** Commit the ref points at (annotated tags already unwrapped). */
  readonly target: string;
  /** The ref's own object (the tag object for an annotated tag). */
  readonly objectName: string;
  /** Short upstream name, e.g. "origin/main". */
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly upstreamGone: boolean;
  readonly isHead: boolean;
  /** Commit date (or the annotated tag's creation date), Unix seconds — used to sort "recent branches". */
  readonly date: number | null;
}

const REF_PREFIX: Record<RefKind, string> = {
  localBranch: 'refs/heads/',
  remoteBranch: 'refs/remotes/',
  tag: 'refs/tags/',
};

/** "main", "origin/main", "v1.0". */
export function refName(ref: Pick<GitRef, 'fullName' | 'kind'>): string {
  return ref.fullName.slice(REF_PREFIX[ref.kind].length);
}

/**
 * Remote whose name is the LONGEST prefix of the ref name (`refs/remotes/<remote>/<branch>`). Remote names may contain
 * `/` (`team/a`), so the owner cannot be derived by splitting at the first `/`; with both `team` and `team/a`
 * configured, `team/a/main` belongs to `team/a` (git is ambiguous here too — longest match keeps every ref in exactly
 * ONE remote). No matching remote → `null`.
 */
function matchRemote(name: string, remoteNames: readonly string[]): string | null {
  let best: string | null = null;
  for (const candidate of remoteNames) {
    if (candidate === '' || name.length <= candidate.length + 1 || !name.startsWith(`${candidate}/`))
      continue;
    if (best === null || candidate.length > best.length) best = candidate;
  }
  return best;
}

/**
 * Remote name of a remote branch. Pass `remoteNames` (the configured remotes) so a remote containing `/` is recognised;
 * when it is missing or nothing matches, split at the first `/`.
 */
export function refRemoteName(
  ref: Pick<GitRef, 'fullName' | 'kind'>,
  remoteNames: readonly string[] = [],
): string | null {
  if (ref.kind !== 'remoteBranch') return null;
  const name = refName(ref);
  const known = matchRemote(name, remoteNames);
  if (known !== null) return known;
  const slash = name.indexOf('/');
  return slash > 0 ? name.slice(0, slash) : name;
}

/** For the remote branch "origin/feature/x" returns "feature/x" (split at the longest remote match, see `refRemoteName`). */
export function refShortBranchName(
  ref: Pick<GitRef, 'fullName' | 'kind'>,
  remoteNames: readonly string[] = [],
): string {
  const name = refName(ref);
  if (ref.kind !== 'remoteBranch') return name;
  const known = matchRemote(name, remoteNames);
  if (known !== null) return name.slice(known.length + 1);
  const slash = name.indexOf('/');
  return slash > 0 && slash < name.length - 1 ? name.slice(slash + 1) : name;
}

export function isAnnotatedTag(ref: Pick<GitRef, 'kind' | 'objectName' | 'target'>): boolean {
  return ref.kind === 'tag' && ref.objectName !== ref.target;
}

// MARK: - HEAD

export type HeadState =
  /** Currently on a branch. `oid === null` means the branch has no commits yet. */
  | { readonly kind: 'branch'; readonly name: string; readonly oid: string | null }
  | { readonly kind: 'detached'; readonly oid: string }
  | { readonly kind: 'unknown' };

export function headOid(head: HeadState): string | null {
  return head.kind === 'unknown' ? null : head.oid;
}

export function headBranchName(head: HeadState): string | null {
  return head.kind === 'branch' ? head.name : null;
}

export function isDetachedHead(head: HeadState): boolean {
  return head.kind === 'detached';
}

export function isUnbornHead(head: HeadState): boolean {
  return head.kind === 'branch' && head.oid === null;
}

// MARK: - Stash

export interface Stash {
  readonly index: number;
  readonly selector: string;
  readonly sha: string;
  readonly parents: readonly string[];
  /** Unix seconds. */
  readonly date: number;
  readonly message: string;
}

/** Like Swift's `split(separator, maxSplits: 1)` (empty pieces omitted): 0, 1 or 2 elements. */
function splitOnceOmittingEmpty(text: string, separator: string): string[] {
  const at = text.indexOf(separator);
  if (at < 0) return text === '' ? [] : [text];
  const head = text.slice(0, at);
  const tail = text.slice(at + separator.length);
  return [head, tail].filter((part) => part !== '');
}

/**
 * "On main: message" → "message". A stash git named itself "WIP on main: abc123 msg" → "WIP on main: msg"
 * (keeping the word WIP so it is not mistaken for a commit message). `wipLabel` lets the UI phrase it per language.
 */
export function stashDisplayMessage(
  stash: Pick<Stash, 'message'>,
  wipLabel: (branch: string, subject: string) => string = (branch, subject) =>
    `WIP trên ${branch}: ${subject}`,
): string {
  const { message } = stash;
  const parts = splitOnceOmittingEmpty(message, ':');
  const [head, tail] = parts;
  if (parts.length !== 2 || head === undefined || tail === undefined) return message;
  const rest = tail.replace(/^[ \t]+|[ \t]+$/g, '');
  if (message.startsWith('WIP on ')) {
    const branch = head.slice('WIP on '.length);
    const words = splitOnceOmittingEmpty(rest, ' ');
    const [first, remainder] = words;
    const subject =
      words.length === 2 && first !== undefined && remainder !== undefined && /^[0-9A-Fa-f]{7,}$/.test(first)
        ? remainder
        : rest;
    return wipLabel(branch, subject);
  }
  return rest;
}

/** The branch the stash was created on. */
export function stashBranchName(stash: Pick<Stash, 'message'>): string | null {
  const head = splitOnceOmittingEmpty(stash.message, ':')[0];
  if (head === undefined) return null;
  for (const prefix of ['WIP on ', 'On ']) {
    if (head.startsWith(prefix)) return head.slice(prefix.length);
  }
  return null;
}

// MARK: - Remote

export interface Remote {
  readonly name: string;
  readonly fetchUrl: string;
  readonly pushUrl: string;
}

// MARK: - File changes

export type ChangeKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typeChanged'
  | 'untracked'
  | 'conflicted'
  | 'unknown';

const CHANGE_KIND_BY_CODE: Readonly<Record<string, ChangeKind>> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typeChanged',
  '?': 'untracked',
  U: 'conflicted',
};

/** Git's one-character status code (`A`, `M`, `D`, `R`, `C`, `T`, `?`, `U`) → change kind. */
export function changeKindFromCode(code: string): ChangeKind {
  return Object.hasOwn(CHANGE_KIND_BY_CODE, code) ? (CHANGE_KIND_BY_CODE[code] ?? 'unknown') : 'unknown';
}

export interface FileChange {
  readonly path: string;
  /** Only for renames/copies. */
  readonly oldPath?: string;
  readonly kind: ChangeKind;
}

export function fileChange(path: string, kind: ChangeKind, oldPath?: string): FileChange {
  return oldPath === undefined ? { path, kind } : { path, oldPath, kind };
}

export function fileChangeName(change: Pick<FileChange, 'path'>): string {
  return gitBasename(change.path);
}

export function fileChangeDirectory(change: Pick<FileChange, 'path'>): string {
  return gitDirname(change.path);
}

/** Every related path (so a rename is recognised when diffing by pathspec). */
export function fileChangeAllPaths(change: Pick<FileChange, 'path' | 'oldPath'>): string[] {
  return change.oldPath !== undefined && change.oldPath !== change.path
    ? [change.oldPath, change.path]
    : [change.path];
}

// MARK: - Conflicts

export type ConflictKind =
  | 'bothModified' // UU
  | 'bothAdded' // AA
  | 'deletedByUs' // DU
  | 'deletedByThem' // UD
  | 'addedByUs' // AU
  | 'addedByThem' // UA
  | 'bothDeleted' // DD
  | 'unknown';

const CONFLICT_KIND_BY_CODE: Readonly<Record<string, ConflictKind>> = {
  UU: 'bothModified',
  AA: 'bothAdded',
  DU: 'deletedByUs',
  UD: 'deletedByThem',
  AU: 'addedByUs',
  UA: 'addedByThem',
  DD: 'bothDeleted',
};

/** porcelain v2 XY code (`UU`, `AA`…) → conflict kind. */
export function conflictKindFromCode(code: string): ConflictKind {
  return Object.hasOwn(CONFLICT_KIND_BY_CODE, code) ? (CONFLICT_KIND_BY_CODE[code] ?? 'unknown') : 'unknown';
}

/**
 * Does a file with conflict markers exist in the working tree?
 *
 * The core does not turn `ConflictKind` into a sentence: the app uses its own translation
 * (`vi.branches.conflictKinds`), like the Swift version's `String(localized:)`. That keeps the core free of hardcoded
 * Vietnamese — an earlier `conflictDescription()` returned Vietnamese text that leaked into the English UI.
 */
export function conflictHasMarkers(kind: ConflictKind): boolean {
  return kind === 'bothModified' || kind === 'bothAdded';
}

export interface ConflictEntry {
  readonly path: string;
  readonly kind: ConflictKind;
}

export function conflictAsChange(entry: ConflictEntry): FileChange {
  return { path: entry.path, kind: 'conflicted' };
}

// MARK: - Working-tree status

export interface WorkingTreeStatus {
  readonly head: HeadState;
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly staged: readonly FileChange[];
  readonly unstaged: readonly FileChange[];
  readonly conflicts: readonly ConflictEntry[];
  readonly stashCount: number;
}

export const EMPTY_STATUS: WorkingTreeStatus = {
  head: { kind: 'unknown' },
  upstream: null,
  ahead: 0,
  behind: 0,
  staged: [],
  unstaged: [],
  conflicts: [],
  stashCount: 0,
};

export function isStatusClean(status: Pick<WorkingTreeStatus, 'staged' | 'unstaged' | 'conflicts'>): boolean {
  return status.staged.length === 0 && status.unstaged.length === 0 && status.conflicts.length === 0;
}

/** Number of differing files with changes. */
export function changedFileCount(
  status: Pick<WorkingTreeStatus, 'staged' | 'unstaged' | 'conflicts'>,
): number {
  const paths = new Set<string>();
  for (const change of status.staged) paths.add(change.path);
  for (const change of status.unstaged) paths.add(change.path);
  for (const entry of status.conflicts) paths.add(entry.path);
  return paths.size;
}

// MARK: - Operations in progress

export type RepoOperation =
  | { readonly kind: 'merging' }
  | {
      readonly kind: 'rebasing';
      readonly step: number | null;
      readonly total: number | null;
      readonly headName: string | null;
    }
  | { readonly kind: 'cherryPicking' }
  | { readonly kind: 'reverting' }
  | { readonly kind: 'applyingPatches' }
  | { readonly kind: 'bisecting' };

/**
 * Short name for building sentences: "Cancel merge", "Continue rebase"… All names are git terminology (English) so the
 * app can plug them into any sentence, including a translated one — see `vi.branches.running` for the localised
 * progress label.
 */
export function operationShortName(operation: RepoOperation): string {
  switch (operation.kind) {
    case 'merging':
      return 'merge';
    case 'rebasing':
      return 'rebase';
    case 'cherryPicking':
      return 'cherry-pick';
    case 'reverting':
      return 'revert';
    case 'applyingPatches':
      return 'apply patch';
    case 'bisecting':
      return 'bisect';
  }
}

export function operationCanContinue(operation: RepoOperation): boolean {
  return operation.kind !== 'bisecting';
}

export function operationCanSkip(operation: RepoOperation): boolean {
  return operation.kind !== 'merging' && operation.kind !== 'bisecting';
}

// MARK: - Commit details

export interface CommitDetails {
  readonly commit: Commit;
  readonly message: string;
  readonly files: readonly FileChange[];
}

// MARK: - Worktrees, submodules

/** A worktree (`git worktree list --porcelain`). */
export interface Worktree {
  readonly path: string;
  /** Checked-out commit (null for a repo with no commits, or a bare repo). */
  readonly head: string | null;
  /** Short branch name (without `refs/heads/`); null when HEAD is detached. */
  readonly branch: string | null;
  readonly bare: boolean;
  readonly locked: boolean;
  /** Directory is gone (git will clean this up with `worktree prune`). */
  readonly prunable: boolean;
}

export type SubmoduleState =
  /** Commit matching what the parent repo records. */
  | 'ok'
  /** Not yet `submodule update --init`. */
  | 'uninitialized'
  /** Checked out at a commit other than the one the parent repo records. */
  | 'modified'
  /** Conflicts on merge. */
  | 'conflict';

/** A submodule (`git submodule status`). */
export interface Submodule {
  /** Path inside the parent repo (with `/`). */
  readonly path: string;
  readonly sha: string;
  readonly state: SubmoduleState;
  /** Git's description (tag / nearest branch); may be empty. */
  readonly describe: string;
}

// MARK: - File history, blame

/** One commit in a file's history (`git log --follow`): `change` is THAT file at that commit (the old name if it was renamed later). */
export interface FileHistoryEntry {
  readonly commit: Commit;
  readonly change: FileChange;
}

/** Commit blame attributes a run of lines to. */
export interface BlameCommit {
  readonly sha: string;
  readonly authorName: string;
  readonly authorEmail: string;
  /** Unix seconds. */
  readonly authorDate: number;
  readonly summary: string;
}

export interface BlameLine {
  /** Line number in the file (starting at 1). */
  readonly number: number;
  readonly text: string;
  readonly sha: string;
  /** First line of a run of consecutive lines sharing a commit (only that line shows the author / commit message). */
  readonly startsGroup: boolean;
}

/** `git blame` result: which commit each line of the file belongs to. */
export interface Blame {
  readonly lines: readonly BlameLine[];
  readonly commits: ReadonlyMap<string, BlameCommit>;
}

/** Uncommitted line (blame over the working tree): git writes an all-zero sha. */
export function isUncommittedBlame(sha: string): boolean {
  return /^0+$/.test(sha);
}

/** Message body (the leading summary line removed). */
export function commitBody(message: string): string {
  const trimmed = message.trim();
  const newline = trimmed.indexOf('\n');
  return newline < 0 ? '' : trimmed.slice(newline).trim();
}

/** Summary line (the first line of the message); an empty message yields `fallback`. */
export function commitSummary(message: string, fallback = ''): string {
  const trimmed = message.trim();
  if (trimmed === '') return fallback;
  const newline = trimmed.indexOf('\n');
  return newline < 0 ? trimmed : trimmed.slice(0, newline);
}

// MARK: - Options

export type ResetMode = 'soft' | 'mixed' | 'hard';

export type PullMode =
  /** Fast-forward when possible, otherwise create a merge commit. */
  'merge' | 'rebase' | 'fastForwardOnly';

export type LogOrder = 'date' | 'topo';

export type MergeStyle =
  /** Fast-forward when possible (git's default). */
  'automatic' | 'noFastForward' | 'fastForwardOnly' | 'squash';

export type WorkingDiffKind = 'unstaged' | 'staged' | 'untracked';
