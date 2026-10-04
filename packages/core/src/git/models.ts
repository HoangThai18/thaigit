// Mô hình dữ liệu git (port Models.swift). Toàn bộ là object thuần (JSON/structured-clone được, chuyển qua Web Worker
// không mất prototype) kèm hàm thuần cho phần Swift viết thành thuộc tính tính toán. Thời điểm là GIÂY UNIX (number).

import { gitBasename, gitDirname } from '../support/paths.ts';

// MARK: - Commit

export interface Commit {
  readonly id: string;
  readonly parents: readonly string[];
  readonly authorName: string;
  readonly authorEmail: string;
  /** Giây Unix. */
  readonly authorDate: number;
  readonly committerName: string;
  readonly committerEmail: string;
  /** Giây Unix. */
  readonly commitDate: number;
  readonly subject: string;
}

/** Commit giả đại diện cho thay đổi chưa commit (node "WIP" trên graph). */
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
  /** Commit mà ref trỏ tới (đã bóc tag annotated). */
  readonly target: string;
  /** Object của chính ref (tag object với annotated tag). */
  readonly objectName: string;
  /** Upstream dạng rút gọn, ví dụ "origin/main". */
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly upstreamGone: boolean;
  readonly isHead: boolean;
  /** Ngày commit (hoặc ngày tạo tag annotated), giây Unix — để xếp "nhánh gần đây". */
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
 * Remote khớp DÀI NHẤT với phần đầu tên ref (`refs/remotes/<remote>/<nhánh>`). Tên remote có thể chứa `/` (`team/a`), nên không
 * thể suy ra bằng cách cắt ở dấu `/` đầu tiên; khi có cả `team` lẫn `team/a` thì `team/a/main` thuộc `team/a` (git cũng mơ hồ ở
 * đây — chọn khớp dài nhất để mỗi ref thuộc đúng MỘT remote). Không remote nào khớp → `null`.
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
 * Tên remote của nhánh remote. Truyền `remoteNames` (danh sách remote đã cấu hình) để nhận đúng remote có `/` trong tên; thiếu
 * hoặc không khớp thì cắt ở dấu `/` đầu tiên.
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

/** Với nhánh remote "origin/feature/x" trả về "feature/x" (cắt theo remote khớp dài nhất, xem `refRemoteName`). */
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
  /** Đang ở một nhánh. `oid === null` nghĩa là nhánh chưa có commit nào. */
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
  /** Giây Unix. */
  readonly date: number;
  readonly message: string;
}

/** Như `split(separator, maxSplits: 1)` của Swift (bỏ phần rỗng): 0, 1 hoặc 2 phần tử. */
function splitOnceOmittingEmpty(text: string, separator: string): string[] {
  const at = text.indexOf(separator);
  if (at < 0) return text === '' ? [] : [text];
  const head = text.slice(0, at);
  const tail = text.slice(at + separator.length);
  return [head, tail].filter((part) => part !== '');
}

/**
 * "On main: tin nhắn" → "tin nhắn". Stash tự đặt tên "WIP on main: abc123 msg" → "WIP trên main: msg"
 * (giữ chữ WIP để không bị nhầm với tên commit). `wipLabel` cho giao diện đổi chữ theo ngôn ngữ.
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

/** Nhánh mà stash được tạo ra. */
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

// MARK: - Thay đổi file

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

/** Mã một ký tự của git (`A`, `M`, `D`, `R`, `C`, `T`, `?`, `U`) → loại thay đổi. */
export function changeKindFromCode(code: string): ChangeKind {
  return Object.hasOwn(CHANGE_KIND_BY_CODE, code) ? (CHANGE_KIND_BY_CODE[code] ?? 'unknown') : 'unknown';
}

export interface FileChange {
  readonly path: string;
  /** Chỉ có với rename/copy. */
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

/** Tất cả đường dẫn liên quan (để rename được nhận diện khi diff theo pathspec). */
export function fileChangeAllPaths(change: Pick<FileChange, 'path' | 'oldPath'>): string[] {
  return change.oldPath !== undefined && change.oldPath !== change.path
    ? [change.oldPath, change.path]
    : [change.path];
}

// MARK: - Xung đột

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

/** Mã XY của porcelain v2 (`UU`, `AA`…) → loại xung đột. */
export function conflictKindFromCode(code: string): ConflictKind {
  return Object.hasOwn(CONFLICT_KIND_BY_CODE, code) ? (CONFLICT_KIND_BY_CODE[code] ?? 'unknown') : 'unknown';
}

const CONFLICT_DESCRIPTIONS: Readonly<Record<ConflictKind, string>> = {
  bothModified: 'Cả hai bên đều sửa',
  bothAdded: 'Cả hai bên đều thêm',
  deletedByUs: 'Bên hiện tại đã xoá',
  deletedByThem: 'Bên kia đã xoá',
  addedByUs: 'Bên hiện tại thêm',
  addedByThem: 'Bên kia thêm',
  bothDeleted: 'Cả hai bên đều xoá',
  unknown: 'Xung đột',
};

export function conflictDescription(kind: ConflictKind): string {
  return CONFLICT_DESCRIPTIONS[kind];
}

/** Có tồn tại file kèm dấu xung đột trong working tree không. */
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

// MARK: - Trạng thái working tree

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

/** Số file khác nhau có thay đổi. */
export function changedFileCount(
  status: Pick<WorkingTreeStatus, 'staged' | 'unstaged' | 'conflicts'>,
): number {
  const paths = new Set<string>();
  for (const change of status.staged) paths.add(change.path);
  for (const change of status.unstaged) paths.add(change.path);
  for (const entry of status.conflicts) paths.add(entry.path);
  return paths.size;
}

// MARK: - Thao tác dở dang

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

export function operationTitle(operation: RepoOperation): string {
  switch (operation.kind) {
    case 'merging':
      return 'Đang merge';
    case 'rebasing':
      return operation.step !== null && operation.total !== null
        ? `Đang rebase (${operation.step}/${operation.total})`
        : 'Đang rebase';
    case 'cherryPicking':
      return 'Đang cherry-pick';
    case 'reverting':
      return 'Đang revert';
    case 'applyingPatches':
      return 'Đang áp dụng patch (git am)';
    case 'bisecting':
      return 'Đang bisect';
  }
}

/** Tên ngắn để ghép câu: "Huỷ merge", "Tiếp tục rebase"… */
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
      return 'áp dụng patch';
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

// MARK: - Chi tiết commit

export interface CommitDetails {
  readonly commit: Commit;
  readonly message: string;
  readonly files: readonly FileChange[];
}

// MARK: - Worktree, submodule

/** Một worktree (`git worktree list --porcelain`). */
export interface Worktree {
  readonly path: string;
  /** Commit đang checkout (`null` với repo chưa có commit / bare). */
  readonly head: string | null;
  /** Tên nhánh ngắn (không có `refs/heads/`); `null` khi detached HEAD. */
  readonly branch: string | null;
  readonly bare: boolean;
  readonly locked: boolean;
  /** Thư mục không còn (git sẽ dọn khi `worktree prune`). */
  readonly prunable: boolean;
}

export type SubmoduleState =
  /** Khớp commit mà repo cha ghi nhận. */
  | 'ok'
  /** Chưa `submodule update --init`. */
  | 'uninitialized'
  /** Đang ở commit khác commit repo cha ghi nhận. */
  | 'modified'
  /** Xung đột khi merge. */
  | 'conflict';

/** Một submodule (`git submodule status`). */
export interface Submodule {
  /** Đường dẫn trong repo cha (dấu `/`). */
  readonly path: string;
  readonly sha: string;
  readonly state: SubmoduleState;
  /** Mô tả của git (tag / nhánh gần nhất), có thể rỗng. */
  readonly describe: string;
}

// MARK: - Lịch sử một file, blame

/** Một commit trong lịch sử của một file (`git log --follow`): `change` là file ĐÓ ở commit đó (tên cũ nếu sau này đổi tên). */
export interface FileHistoryEntry {
  readonly commit: Commit;
  readonly change: FileChange;
}

/** Commit mà blame quy một nhóm dòng về. */
export interface BlameCommit {
  readonly sha: string;
  readonly authorName: string;
  readonly authorEmail: string;
  /** Giây Unix. */
  readonly authorDate: number;
  readonly summary: string;
}

export interface BlameLine {
  /** Số dòng trong file (bắt đầu từ 1). */
  readonly number: number;
  readonly text: string;
  readonly sha: string;
  /** Dòng đầu của một nhóm dòng liền nhau cùng commit (chỉ dòng này hiện tác giả / lời commit). */
  readonly startsGroup: boolean;
}

/** Kết quả `git blame`: từng dòng của file thuộc commit nào. */
export interface Blame {
  readonly lines: readonly BlameLine[];
  readonly commits: ReadonlyMap<string, BlameCommit>;
}

/** Dòng chưa commit (blame trên working tree): git ghi sha toàn số 0. */
export function isUncommittedBlame(sha: string): boolean {
  return /^0+$/.test(sha);
}

/** Phần thân message (bỏ dòng tóm tắt đầu tiên). */
export function commitBody(message: string): string {
  const trimmed = message.trim();
  const newline = trimmed.indexOf('\n');
  return newline < 0 ? '' : trimmed.slice(newline).trim();
}

/** Dòng tóm tắt (dòng đầu của message); message rỗng → `fallback`. */
export function commitSummary(message: string, fallback = ''): string {
  const trimmed = message.trim();
  if (trimmed === '') return fallback;
  const newline = trimmed.indexOf('\n');
  return newline < 0 ? trimmed : trimmed.slice(0, newline);
}

// MARK: - Tuỳ chọn

export type ResetMode = 'soft' | 'mixed' | 'hard';

export type PullMode =
  /** Fast-forward nếu được, không thì tạo merge commit. */
  'merge' | 'rebase' | 'fastForwardOnly';

export type LogOrder = 'date' | 'topo';

export type MergeStyle =
  /** Fast-forward nếu có thể (mặc định của git). */
  'automatic' | 'noFastForward' | 'fastForwardOnly' | 'squash';

export type WorkingDiffKind = 'unstaged' | 'staged' | 'untracked';
