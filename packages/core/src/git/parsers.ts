// Parse output của các lệnh git plumbing/porcelain có định dạng máy đọc được (port Parsers.swift).
// Mọi hàm là THUẦN (bytes/chuỗi → mô hình) nên chạy được trong Web Worker. Giải mã UTF-8 lossy như Swift.

import { decodeUtf8, encodeUtf8 } from './bytes.ts';
import {
  changeKindFromCode,
  conflictKindFromCode,
  fileChange,
  type Blame,
  type BlameCommit,
  type BlameLine,
  type ChangeKind,
  type Commit,
  type ConflictEntry,
  type FileChange,
  type FileHistoryEntry,
  type Submodule,
  type SubmoduleState,
  type Worktree,
  type GitRef,
  type HeadState,
  type RefKind,
  type Remote,
  type Stash,
  type WorkingTreeStatus,
} from './models.ts';

const UNIT_SEPARATOR = '\x1f';

function asText(input: Uint8Array | string): string {
  return typeof input === 'string' ? input : decodeUtf8(input);
}

/** Như `split(separator, maxSplits:, omittingEmptySubsequences: false)` của Swift: tối đa `maxSplits + 1` phần, phần cuối giữ nguyên phần còn lại. */
function splitLimited(text: string, separator: string, maxSplits: number): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let splits = 0; splits < maxSplits; splits++) {
    const at = text.indexOf(separator, start);
    if (at < 0) break;
    parts.push(text.slice(start, at));
    start = at + separator.length;
  }
  parts.push(text.slice(start));
  return parts;
}

/** Tách theo `separator`, bỏ phần rỗng (mặc định của `split` trong Swift). */
function splitOmittingEmpty(text: string, separator: string): string[] {
  return text.split(separator).filter((part) => part !== '');
}

/** `Double(text)` của Swift: chuỗi rỗng/không phải số → null. */
function parseNumber(text: string): number | null {
  if (text === '') return null;
  const value = Number(text);
  return Number.isNaN(value) ? null : value;
}

/** `Int(text)` của Swift: chỉ nhận số nguyên thập phân có dấu tuỳ chọn. */
function parseInteger(text: string): number | null {
  return /^[+-]?\d+$/.test(text) ? Number(text) : null;
}

// MARK: - Log

/** Dùng với `git log -z --format=...`: mỗi commit kết thúc bằng NUL, các trường ngăn bởi \x1f. */
export const LOG_FORMAT = '%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%s';

export function parseLog(data: Uint8Array | string): Commit[] {
  const text = asText(data);
  const commits: Commit[] = [];
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\0', start);
    if (end < 0) end = text.length;
    if (end > start) {
      // Một số phiên bản git chèn "\n" trước bản ghi kế tiếp.
      const from = text.charCodeAt(start) === 0x0a ? start + 1 : start;
      const fields = splitLimited(text.slice(from, end), UNIT_SEPARATOR, 8);
      const [
        id,
        parents,
        authorName,
        authorEmail,
        authorDate,
        committerName,
        committerEmail,
        commitDate,
        subject,
      ] = fields;
      if (
        fields.length === 9 &&
        id !== undefined &&
        id.length >= 7 &&
        parents !== undefined &&
        authorName !== undefined &&
        authorEmail !== undefined &&
        authorDate !== undefined &&
        committerName !== undefined &&
        committerEmail !== undefined &&
        commitDate !== undefined &&
        subject !== undefined
      ) {
        commits.push({
          id,
          parents: splitOmittingEmpty(parents, ' '),
          authorName,
          authorEmail,
          authorDate: parseNumber(authorDate) ?? 0,
          committerName,
          committerEmail,
          commitDate: parseNumber(commitDate) ?? 0,
          subject,
        });
      }
    }
    start = end + 1;
  }
  return commits;
}

// MARK: - Lịch sử một file

/**
 * Định dạng cho `git log -z --follow --name-status`: \x1e mở đầu bản ghi commit để phân biệt với token của name-status
 * (cũng ngăn bằng NUL).
 */
export const FILE_HISTORY_FORMAT = `%x1e${LOG_FORMAT}`;

/**
 * Parse `git log -z --format=FILE_HISTORY_FORMAT --follow --name-status -- <path>`. Đi từ mới về cũ: commit đổi tên
 * (`R100 cũ mới`) làm các commit cũ hơn mang tên cũ. Commit không kèm name-status (merge) lấy tên đang theo dõi.
 */
export function parseFileHistory(data: Uint8Array | string, path: string): FileHistoryEntry[] {
  const tokens = asText(data).split('\0');
  const entries: FileHistoryEntry[] = [];
  let tracked = path;
  let commit: Commit | null = null;
  let change: FileChange | null = null;
  for (let index = 0; index < tokens.length; index++) {
    const raw = tokens[index] ?? '';
    // Một số phiên bản git chèn "\n" trước bản ghi kế tiếp / trước name-status.
    const token = raw.startsWith('\n') ? raw.slice(1) : raw;
    if (token.startsWith('\x1e')) {
      if (commit !== null) entries.push({ commit, change: change ?? fileChange(tracked, 'modified') });
      commit = parseLog(token.slice(1))[0] ?? null;
      change = null;
      continue;
    }
    if (commit === null || change !== null || token === '') continue;
    const code = token.charAt(0);
    if (code === 'R' || code === 'C') {
      const oldPath = tokens[index + 1] ?? '';
      const newPath = tokens[index + 2] ?? '';
      index += 2;
      if (oldPath === '' || newPath === '') continue;
      change = fileChange(newPath, code === 'R' ? 'renamed' : 'copied', oldPath);
      tracked = oldPath;
    } else {
      const filePath = tokens[index + 1] ?? '';
      index += 1;
      if (filePath === '') continue;
      change = fileChange(filePath, changeKindFromCode(code));
      tracked = filePath;
    }
  }
  if (commit !== null) entries.push({ commit, change: change ?? fileChange(tracked, 'modified') });
  return entries;
}

// MARK: - Worktree, submodule

/** Parse `git worktree list --porcelain -z`: các trường ngăn bởi NUL, mỗi worktree kết thúc bằng một trường rỗng. */
export function parseWorktrees(data: Uint8Array | string): Worktree[] {
  const result: Worktree[] = [];
  let current: { -readonly [K in keyof Worktree]: Worktree[K] } | null = null;
  const flush = (): void => {
    if (current !== null) result.push(current);
    current = null;
  };
  for (const field of asText(data).split('\0')) {
    if (field === '') {
      flush();
      continue;
    }
    const space = field.indexOf(' ');
    const key = space < 0 ? field : field.slice(0, space);
    const value = space < 0 ? '' : field.slice(space + 1);
    if (key === 'worktree') {
      flush();
      current = { path: value, head: null, branch: null, bare: false, locked: false, prunable: false };
      continue;
    }
    if (current === null) continue;
    if (key === 'HEAD') current.head = /^0+$/.test(value) ? null : value;
    else if (key === 'branch') current.branch = value.startsWith('refs/heads/') ? value.slice(11) : value;
    else if (key === 'bare') current.bare = true;
    else if (key === 'locked') current.locked = true;
    else if (key === 'prunable') current.prunable = true;
  }
  flush();
  return result;
}

const SUBMODULE_STATES: Readonly<Record<string, SubmoduleState>> = {
  ' ': 'ok',
  '-': 'uninitialized',
  '+': 'modified',
  U: 'conflict',
};

/** Parse `git submodule status`: mỗi dòng "<trạng thái><sha> <đường dẫn>[ (<mô tả>)]". */
export function parseSubmoduleStatus(data: Uint8Array | string): Submodule[] {
  const result: Submodule[] = [];
  for (const line of asText(data).split('\n')) {
    if (line.length < 3) continue;
    const state = SUBMODULE_STATES[line.charAt(0)];
    const rest = line.slice(1);
    const space = rest.indexOf(' ');
    if (state === undefined || space < 0) continue;
    const sha = rest.slice(0, space);
    let path = rest.slice(space + 1);
    let describe = '';
    const open = path.lastIndexOf(' (');
    if (open >= 0 && path.endsWith(')')) {
      describe = path.slice(open + 2, -1);
      path = path.slice(0, open);
    }
    if (path === '') continue;
    result.push({ path, sha, state, describe });
  }
  return result;
}

// MARK: - Blame

const BLAME_HEADER = /^([0-9a-f]{40}|[0-9a-f]{64}) \d+ \d+/;

/**
 * Parse `git blame --porcelain` (port Blame.parse của app Swift): mỗi dòng mở đầu bằng "<sha> <dòng gốc> <dòng mới> [số dòng]",
 * thông tin commit (author, author-mail, author-time, summary…) chỉ có ở lần đầu commit xuất hiện, nội dung dòng bắt đầu bằng
 * tab. Nội dung không phải UTF-8 được giải mã lỏng (chỉ để xem).
 */
export function parseBlame(data: Uint8Array | string): Blame {
  const lines: BlameLine[] = [];
  const commits = new Map<string, BlameCommit>();
  let current: string | null = null;
  let previous: string | null = null;
  for (const raw of asText(data).split('\n')) {
    if (raw.startsWith('\t')) {
      if (current === null) continue;
      const text = raw.endsWith('\r') ? raw.slice(1, -1) : raw.slice(1);
      lines.push({ number: lines.length + 1, text, sha: current, startsGroup: current !== previous });
      previous = current;
      continue;
    }
    const header = BLAME_HEADER.exec(raw);
    if (header) {
      current = header[1] ?? null;
      if (current !== null && !commits.has(current)) {
        commits.set(current, { sha: current, authorName: '', authorEmail: '', authorDate: 0, summary: '' });
      }
      continue;
    }
    if (current === null) continue;
    const info = commits.get(current);
    if (!info) continue;
    const space = raw.indexOf(' ');
    const key = space < 0 ? raw : raw.slice(0, space);
    const value = space < 0 ? '' : raw.slice(space + 1);
    if (key === 'author') commits.set(current, { ...info, authorName: value });
    else if (key === 'author-mail')
      commits.set(current, { ...info, authorEmail: value.replace(/^<|>$/g, '') });
    else if (key === 'author-time') commits.set(current, { ...info, authorDate: parseInteger(value) ?? 0 });
    else if (key === 'summary') commits.set(current, { ...info, summary: value });
  }
  return { lines, commits };
}

// MARK: - Refs

/** Dùng với `git for-each-ref --format=...`: %1f là ký tự \x1f. */
export const REF_FORMAT =
  '%(refname)%1f%(objectname)%1f%(*objectname)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(HEAD)%1f%(symref)%1f%(creatordate:unix)';

function refKindOf(fullName: string): RefKind | null {
  if (fullName.startsWith('refs/heads/')) return 'localBranch';
  if (fullName.startsWith('refs/remotes/')) return 'remoteBranch';
  if (fullName.startsWith('refs/tags/')) return 'tag';
  return null;
}

export function parseRefs(input: Uint8Array | string): GitRef[] {
  const refs: GitRef[] = [];
  for (const line of splitOmittingEmpty(asText(input), '\n')) {
    const f = line.split(UNIT_SEPARATOR);
    const [fullName, objectName, peeled, upstream, track, head, symref, date] = f;
    if (
      f.length < 7 ||
      fullName === undefined ||
      objectName === undefined ||
      peeled === undefined ||
      upstream === undefined ||
      track === undefined ||
      head === undefined ||
      symref === undefined
    ) {
      continue;
    }
    // Bỏ các symref như refs/remotes/origin/HEAD.
    if (symref !== '') continue;
    const kind = refKindOf(fullName);
    if (kind === null) continue;
    const tracking = parseTrack(track);
    refs.push({
      fullName,
      kind,
      target: peeled === '' ? objectName : peeled,
      objectName,
      upstream: upstream === '' ? null : upstream,
      ahead: tracking.ahead,
      behind: tracking.behind,
      upstreamGone: tracking.gone,
      isHead: head === '*',
      date: f.length > 7 && date !== undefined ? parseNumber(date) : null,
    });
  }
  return refs;
}

/** "ahead 2, behind 1" | "gone" | "" */
export function parseTrack(text: string): { ahead: number; behind: number; gone: boolean } {
  if (text === 'gone') return { ahead: 0, behind: 0, gone: true };
  let ahead = 0;
  let behind = 0;
  for (const part of splitOmittingEmpty(text, ',')) {
    const token = part.replace(/^[ \t]+|[ \t]+$/g, '');
    if (token.startsWith('ahead ')) ahead = parseInteger(token.slice(6)) ?? 0;
    else if (token.startsWith('behind ')) behind = parseInteger(token.slice(7)) ?? 0;
  }
  return { ahead, behind, gone: false };
}

// MARK: - Status (porcelain v2)

function pushStatusEntry(
  x: string,
  y: string,
  path: string,
  origPath: string | undefined,
  staged: FileChange[],
  unstaged: FileChange[],
): void {
  if (x !== '.') {
    const kind = changeKindFromCode(x);
    staged.push(fileChange(path, kind, isRenameOrCopy(kind) ? origPath : undefined));
  }
  if (y !== '.') {
    const kind = changeKindFromCode(y);
    unstaged.push(fileChange(path, kind, isRenameOrCopy(kind) ? origPath : undefined));
  }
}

function isRenameOrCopy(kind: ChangeKind): boolean {
  return kind === 'renamed' || kind === 'copied';
}

/** Parse `git status --porcelain=v2 --branch --show-stash -z`. */
export function parseStatus(data: Uint8Array | string): WorkingTreeStatus {
  const records = splitOmittingEmpty(asText(data), '\0');
  let branchOid: string | null = null;
  let branchHead: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  let stashCount = 0;
  const staged: FileChange[] = [];
  const unstaged: FileChange[] = [];
  const conflicts: ConflictEntry[] = [];

  let index = 0;
  while (index < records.length) {
    const record = records[index] ?? '';
    index += 1;

    if (record.startsWith('# ')) {
      const parts = splitLimited(record.slice(2), ' ', 1);
      const key = parts[0];
      const value = parts[1];
      if (parts.length !== 2 || key === undefined || value === undefined) continue;
      switch (key) {
        case 'branch.oid':
          branchOid = value === '(initial)' ? null : value;
          break;
        case 'branch.head':
          branchHead = value;
          break;
        case 'branch.upstream':
          upstream = value;
          break;
        case 'branch.ab': {
          const ab = splitOmittingEmpty(value, ' ');
          if (ab.length === 2) {
            ahead = parseInteger((ab[0] ?? '').slice(1)) ?? 0;
            behind = parseInteger((ab[1] ?? '').slice(1)) ?? 0;
          }
          break;
        }
        case 'stash':
          stashCount = parseInteger(value) ?? 0;
          break;
        default:
          break;
      }
      continue;
    }

    switch (record[0]) {
      case '1': {
        // 1 XY sub mH mI mW hH hI path
        const f = splitLimited(record, ' ', 8);
        const xy = f[1];
        const path = f[8];
        if (f.length !== 9 || xy === undefined || path === undefined || xy.length !== 2) break;
        pushStatusEntry(xy.charAt(0), xy.charAt(1), path, undefined, staged, unstaged);
        break;
      }
      case '2': {
        // 2 XY sub mH mI mW hH hI Xscore path \0 origPath
        const f = splitLimited(record, ' ', 9);
        const origPath = index < records.length ? records[index] : undefined;
        index += 1;
        const xy = f[1];
        const path = f[9];
        if (f.length !== 10 || xy === undefined || path === undefined || xy.length !== 2) break;
        pushStatusEntry(xy.charAt(0), xy.charAt(1), path, origPath, staged, unstaged);
        break;
      }
      case 'u': {
        // u XY sub m1 m2 m3 mW h1 h2 h3 path
        const f = splitLimited(record, ' ', 10);
        const xy = f[1];
        const path = f[10];
        if (f.length !== 11 || xy === undefined || path === undefined) break;
        conflicts.push({ path, kind: conflictKindFromCode(xy) });
        break;
      }
      case '?':
        unstaged.push(fileChange(record.slice(2), 'untracked'));
        break;
      default:
        break;
    }
  }

  let head: HeadState;
  if (branchHead !== null && branchHead !== '(detached)')
    head = { kind: 'branch', name: branchHead, oid: branchOid };
  else if (branchOid !== null) head = { kind: 'detached', oid: branchOid };
  else head = { kind: 'unknown' };
  return { head, upstream, ahead, behind, staged, unstaged, conflicts, stashCount };
}

// MARK: - Name-status

/** Parse `git diff-tree -r -z --name-status -M ...`. */
export function parseNameStatus(data: Uint8Array | string): FileChange[] {
  const tokens = asText(data).split('\0');
  const result: FileChange[] = [];
  let index = 0;
  while (index < tokens.length) {
    const status = tokens[index] ?? '';
    index += 1;
    const code = status.charAt(0);
    if (code === '') continue;
    if (code === 'R' || code === 'C') {
      if (index + 1 >= tokens.length) break;
      const oldPath = tokens[index] ?? '';
      const newPath = tokens[index + 1] ?? '';
      index += 2;
      result.push(fileChange(newPath, code === 'R' ? 'renamed' : 'copied', oldPath));
    } else {
      if (index >= tokens.length) break;
      const path = tokens[index] ?? '';
      index += 1;
      if (path === '') continue;
      result.push(fileChange(path, changeKindFromCode(code)));
    }
  }
  return result;
}

// MARK: - Stash

export const STASH_FORMAT = '%gd%x1f%H%x1f%P%x1f%ct%x1f%gs';

export function parseStashList(data: Uint8Array | string): Stash[] {
  const stashes: Stash[] = [];
  for (const rawRecord of splitOmittingEmpty(asText(data), '\0')) {
    const record = rawRecord.startsWith('\n') ? rawRecord.slice(1) : rawRecord;
    const f = splitLimited(record, UNIT_SEPARATOR, 4);
    const [selector, sha, parents, date, message] = f;
    if (
      f.length !== 5 ||
      selector === undefined ||
      sha === undefined ||
      parents === undefined ||
      date === undefined ||
      message === undefined
    ) {
      continue;
    }
    // "stash@{3}" → 3; không đọc được thì dùng thứ tự trong danh sách.
    const braces = /\{(\d+)\}/.exec(selector);
    stashes.push({
      index: braces?.[1] !== undefined ? Number(braces[1]) : stashes.length,
      selector,
      sha,
      parents: splitOmittingEmpty(parents, ' '),
      date: parseNumber(date) ?? 0,
      message,
    });
  }
  return stashes;
}

// MARK: - Remotes

/** Parse `git remote -v`. */
export function parseRemotes(input: Uint8Array | string): Remote[] {
  const fetch = new Map<string, string>();
  const push = new Map<string, string>();
  const order: string[] = [];
  for (const line of splitOmittingEmpty(asText(input), '\n')) {
    const parts = line.split('\t');
    // `split(maxSplits: 1)` của Swift: tên, rồi toàn bộ phần còn lại.
    const name = parts[0];
    const rest = parts.slice(1).join('\t');
    if (name === undefined || name === '' || rest === '') continue;
    let url = rest;
    let isPush = false;
    if (url.endsWith(' (push)')) {
      isPush = true;
      url = url.slice(0, -' (push)'.length);
    } else if (url.endsWith(' (fetch)')) {
      url = url.slice(0, -' (fetch)'.length);
    }
    if (!order.includes(name)) order.push(name);
    (isPush ? push : fetch).set(name, url);
  }
  return order.map((name) => ({
    name,
    fetchUrl: fetch.get(name) ?? push.get(name) ?? '',
    pushUrl: push.get(name) ?? fetch.get(name) ?? '',
  }));
}

// MARK: - Tiến trình

/** Rút phần trăm từ dòng tiến độ của git ("Receiving objects:  45% (450/1000)") → 0...1, hoặc null. */
export function progressFraction(line: string): number | null {
  const percent = line.indexOf('%');
  if (percent < 0) return null;
  let start = percent;
  while (start > 0 && /[0-9]/.test(line.charAt(start - 1))) start -= 1;
  if (start >= percent) return null;
  return Math.min(Math.max(Number(line.slice(start, percent)) / 100, 0), 1);
}

// MARK: - Đường dẫn trong ngoặc kép

/** Giải mã đường dẫn bị git đặt trong ngoặc kép kiểu C ("a\tb\"c", "\303\251") → chuỗi UTF-8 (lossy). */
export function unquoteGitPath(text: string): string {
  if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) return text;
  const inner = encodeUtf8(text.slice(1, -1));
  const bytes = new Uint8Array(inner.length);
  let length = 0;
  let i = 0;
  while (i < inner.length) {
    const c = inner[i] ?? 0;
    const n = inner[i + 1];
    if (c !== 0x5c /* \ */ || n === undefined) {
      bytes[length++] = c;
      i += 1;
      continue;
    }
    const simple = SIMPLE_ESCAPES[n];
    if (simple !== undefined) {
      bytes[length++] = simple;
      i += 2;
    } else if (n >= 0x30 && n <= 0x37) {
      let value = 0;
      let j = i + 1;
      let digits = 0;
      while (j < inner.length && digits < 3) {
        const digit = inner[j] ?? 0;
        if (digit < 0x30 || digit > 0x37) break;
        value = (value * 8 + (digit - 0x30)) & 0xff;
        j += 1;
        digits += 1;
      }
      bytes[length++] = value;
      i = j;
    } else {
      bytes[length++] = n;
      i += 2;
    }
  }
  return decodeUtf8(bytes.subarray(0, length));
}

const SIMPLE_ESCAPES: Readonly<Record<number, number>> = {
  0x6e: 0x0a, // \n
  0x74: 0x09, // \t
  0x72: 0x0d, // \r
  0x22: 0x22, // \"
  0x5c: 0x5c, // \\
  0x61: 0x07, // \a
  0x62: 0x08, // \b
  0x66: 0x0c, // \f
  0x76: 0x0b, // \v
};

// MARK: - Tên thư mục clone

/** Tên thư mục mặc định khi clone từ URL ("https://github.com/a/b.git" → "b"). */
export function defaultCloneDirectoryName(url: string): string {
  let trimmed = url.trim();
  while (trimmed.endsWith('/')) trimmed = trimmed.slice(0, -1);
  if (trimmed.endsWith('.git')) trimmed = trimmed.slice(0, -4);
  // Tên này thành tên thư mục: bỏ ký tự điều khiển/ký tự cấm của Windows, không để "." hay "..".
  const last = (trimmed.split(/[/:]/).pop() ?? '').replace(/[\\<>"|?*\u0000-\u001f]/g, '-');
  return last === '' || last === '.' || last === '..' ? 'repo' : last;
}
