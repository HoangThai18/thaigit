// Parse unified diff (`git diff`, `git diff-tree -p`) THEO BYTE.
// Khác bản Swift có chủ đích: tách dòng chỉ theo byte "\n", giữ "\r" trong dòng, nội dung dòng là Uint8Array
// nguyên vẹn (không giải mã) — nhờ vậy patch dựng lại từ đây áp được đúng từng byte (CRLF, CP1252, CP1258…).

import { decodeUtf8Lossy, unquoteGitPath } from '../support/text.ts';
import { LF, startsWithAscii } from './bytes.ts';

export type DiffLineKind = 'context' | 'addition' | 'deletion' | 'noNewline';

export interface DiffLine {
  readonly kind: DiffLineKind;
  /**
   * Byte của dòng, không gồm ký tự đánh dấu đầu dòng (" ", "+", "-") và không gồm "\n" cuối; "\r" giữ nguyên.
   * Với `noNewline`: phần chữ sau "\ ". Là view vào buffer đầu vào — chỉ đọc, không sửa.
   */
  readonly text: Uint8Array;
  readonly oldNumber: number | null;
  readonly newNumber: number | null;
}

export interface DiffHunk {
  /** Thứ tự hunk trong file (từ 0). */
  readonly id: number;
  /** "@@ -1,5 +1,6 @@ func foo()" — giải mã lỏng, chỉ để hiển thị. */
  readonly header: string;
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  /** Phần chữ sau "@@ ... @@" (thường là tên hàm). */
  readonly section: string;
  readonly lines: readonly DiffLine[];
}

export interface FileDiff {
  readonly oldPath: string | null;
  readonly newPath: string | null;
  /** Các dòng header từ "diff --git" đến "+++" (byte, dùng lại nguyên văn khi dựng patch). */
  readonly headerLines: readonly Uint8Array[];
  readonly hunks: readonly DiffHunk[];
  readonly isBinary: boolean;
  readonly isNewFile: boolean;
  readonly isDeletedFile: boolean;
  readonly oldMode: string | null;
  readonly newMode: string | null;
  readonly similarity: number | null;
  readonly additions: number;
  readonly deletions: number;
}

export interface HunkHeader {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly section: string;
}

export function isChangeLine(line: DiffLine): boolean {
  return line.kind === 'addition' || line.kind === 'deletion';
}

/** Chỉ số các dòng thêm/xoá trong hunk. */
export function changeLineIndices(hunk: DiffHunk): number[] {
  const indices: number[] = [];
  hunk.lines.forEach((line, index) => {
    if (isChangeLine(line)) indices.push(index);
  });
  return indices;
}

export function diffLineCount(file: FileDiff): number {
  let total = 0;
  for (const hunk of file.hunks) total += hunk.lines.length;
  return total;
}

/** Có thể stage/unstage/discard từng hunk hoặc từng dòng không. */
export function supportsPartialStaging(file: FileDiff): boolean {
  return (
    !file.isBinary &&
    !file.isNewFile &&
    !file.isDeletedFile &&
    file.hunks.length > 0 &&
    file.headerLines.some((line) => startsWithAscii(line, '--- ')) &&
    file.headerLines.some((line) => startsWithAscii(line, '+++ '))
  );
}

export function isModeChangeOnly(file: FileDiff): boolean {
  return (
    file.hunks.length === 0 &&
    !file.isBinary &&
    file.oldMode !== null &&
    file.newMode !== null &&
    file.oldMode !== file.newMode
  );
}

/** Dựng dần trong lúc parse; kiểu công khai `FileDiff` chỉ-đọc. */
interface FileBuilder {
  oldPath: string | null;
  newPath: string | null;
  headerLines: Uint8Array[];
  hunks: DiffHunk[];
  isBinary: boolean;
  isNewFile: boolean;
  isDeletedFile: boolean;
  oldMode: string | null;
  newMode: string | null;
  similarity: number | null;
  additions: number;
  deletions: number;
}

interface OpenHunk extends HunkHeader {
  readonly header: string;
}

/**
 * Parse output dạng unified diff, có thể gồm nhiều file. Đầu vào là byte thô của git (không giải mã trước).
 * Dòng rỗng hoàn toàn trong hunk bị bỏ qua như bản Swift (git không bao giờ sinh dòng ngữ cảnh rỗng).
 */
export function parseDiff(bytes: Uint8Array): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileBuilder | null = null;
  let inHeader = false;

  let hunkInfo: OpenHunk | null = null;
  let hunkLines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  const flushHunk = (): void => {
    if (hunkInfo !== null && current !== null) {
      current.hunks.push({
        id: current.hunks.length,
        header: hunkInfo.header,
        oldStart: hunkInfo.oldStart,
        oldCount: hunkInfo.oldCount,
        newStart: hunkInfo.newStart,
        newCount: hunkInfo.newCount,
        section: hunkInfo.section,
        lines: hunkLines,
      });
    }
    hunkInfo = null;
    hunkLines = [];
  };

  const flushFile = (): void => {
    flushHunk();
    if (current !== null) files.push(current);
    current = null;
  };

  let position = 0;
  while (position < bytes.length) {
    const lineFeed = bytes.indexOf(LF, position);
    const lineEnd = lineFeed === -1 ? bytes.length : lineFeed;
    const line = bytes.subarray(position, lineEnd);
    position = lineEnd + 1;

    if (startsWithAscii(line, 'diff --git ')) {
      flushFile();
      current = newFileBuilder(line);
      inHeader = true;
      continue;
    }
    if (current === null) continue;

    if (inHeader) {
      if (startsWithAscii(line, '@@ ')) {
        inHeader = false;
      } else {
        parseHeaderLine(current, line);
        continue;
      }
    }

    if (startsWithAscii(line, '@@ ')) {
      flushHunk();
      const header = decodeUtf8Lossy(line);
      const parsed = parseHunkHeader(header);
      if (parsed !== null) {
        hunkInfo = { header, ...parsed };
        oldLine = parsed.oldStart;
        newLine = parsed.newStart;
      }
      continue;
    }

    if (hunkInfo === null || line.length === 0) continue;
    switch (line[0]) {
      case 0x20: // " " ngữ cảnh
        hunkLines.push({ kind: 'context', text: line.subarray(1), oldNumber: oldLine, newNumber: newLine });
        oldLine += 1;
        newLine += 1;
        break;
      case 0x2b: // "+"
        hunkLines.push({ kind: 'addition', text: line.subarray(1), oldNumber: null, newNumber: newLine });
        newLine += 1;
        current.additions += 1;
        break;
      case 0x2d: // "-"
        hunkLines.push({ kind: 'deletion', text: line.subarray(1), oldNumber: oldLine, newNumber: null });
        oldLine += 1;
        current.deletions += 1;
        break;
      case 0x5c: // "\ No newline at end of file"
        hunkLines.push({ kind: 'noNewline', text: line.subarray(2), oldNumber: null, newNumber: null });
        break;
      default:
        break;
    }
  }
  flushFile();
  return files;
}

function newFileBuilder(firstLine: Uint8Array): FileBuilder {
  return {
    oldPath: null,
    newPath: null,
    headerLines: [firstLine],
    hunks: [],
    isBinary: false,
    isNewFile: false,
    isDeletedFile: false,
    oldMode: null,
    newMode: null,
    similarity: null,
    additions: 0,
    deletions: 0,
  };
}

function parseHeaderLine(file: FileBuilder, line: Uint8Array): void {
  file.headerLines.push(line);
  const tail = (prefix: string): string => decodeUtf8Lossy(line.subarray(prefix.length));
  if (startsWithAscii(line, '--- ')) {
    file.oldPath = parsePath(tail('--- '));
  } else if (startsWithAscii(line, '+++ ')) {
    file.newPath = parsePath(tail('+++ '));
  } else if (startsWithAscii(line, 'new file mode ')) {
    file.isNewFile = true;
    file.newMode = tail('new file mode ');
  } else if (startsWithAscii(line, 'deleted file mode ')) {
    file.isDeletedFile = true;
    file.oldMode = tail('deleted file mode ');
  } else if (startsWithAscii(line, 'old mode ')) {
    file.oldMode = tail('old mode ');
  } else if (startsWithAscii(line, 'new mode ')) {
    file.newMode = tail('new mode ');
  } else if (startsWithAscii(line, 'rename from ')) {
    file.oldPath = unquoteGitPath(tail('rename from '));
  } else if (startsWithAscii(line, 'rename to ')) {
    file.newPath = unquoteGitPath(tail('rename to '));
  } else if (startsWithAscii(line, 'similarity index ')) {
    // "similarity index 90%": bỏ dấu % cuối.
    file.similarity = parseUnsigned(tail('similarity index ').slice(0, -1));
  } else if (startsWithAscii(line, 'Binary files ') || startsWithAscii(line, 'GIT binary patch')) {
    file.isBinary = true;
    // File nhị phân không có dòng "---"/"+++": lấy đường dẫn từ "Binary files a/x and b/y differ".
    if (file.oldPath === null && file.newPath === null && startsWithAscii(line, 'Binary files ')) {
      const paths = binaryPaths(tail('Binary files '));
      if (paths !== null) [file.oldPath, file.newPath] = paths;
    }
  }
}

/** "a/x and b/y differ" → [x, y] (`/dev/null` → null). Thử từng chỗ " and " vì tên file có thể chứa chữ đó. */
function binaryPaths(rest: string): [string | null, string | null] | null {
  if (!rest.endsWith(' differ')) return null;
  const body = rest.slice(0, -' differ'.length);
  for (let at = body.indexOf(' and '); at !== -1; at = body.indexOf(' and ', at + 1)) {
    const left = body.slice(0, at);
    const right = body.slice(at + ' and '.length);
    const isSide = (value: string, prefix: string) =>
      value === '/dev/null' || value.startsWith(prefix) || value.startsWith(`"${prefix}`);
    if (isSide(left, 'a/') && isSide(right, 'b/')) return [parsePath(left), parsePath(right)];
  }
  return null;
}

/** "a/path" → "path", "/dev/null" → null. Git thêm TAB cuối đường dẫn có dấu cách. */
export function parsePath(raw: string): string | null {
  let value = raw;
  if (value.endsWith('\t')) value = value.slice(0, -1);
  value = unquoteGitPath(value);
  if (value === '/dev/null') return null;
  if (value.startsWith('a/') || value.startsWith('b/')) value = value.slice(2);
  return value;
}

/** Số nguyên không âm gồm toàn chữ số thập phân (tối đa 15 chữ số); khác → null. */
function parseUnsigned(text: string): number | null {
  if (text.length === 0 || text.length > 15) return null;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x30 || code > 0x39) return null;
  }
  return Number(text);
}

function parseRange(text: string): { start: number; count: number } | null {
  const comma = text.indexOf(',');
  const start = parseUnsigned(comma === -1 ? text : text.slice(0, comma));
  if (start === null) return null;
  if (comma === -1) return { start, count: 1 };
  const nextComma = text.indexOf(',', comma + 1);
  const count = parseUnsigned(text.slice(comma + 1, nextComma === -1 ? undefined : nextComma)) ?? 1;
  return { start, count };
}

/** "@@ -1,5 +1,6 @@ func foo()" (dòng đã giải mã, bắt đầu bằng "@@ "). */
export function parseHunkHeader(line: string): HunkHeader | null {
  const body = line.slice(3);
  const end = body.indexOf(' @@');
  if (end === -1) return null;
  const ranges = body
    .slice(0, end)
    .split(' ')
    .filter((part) => part.length > 0);
  const [oldText, newText] = ranges;
  if (ranges.length !== 2 || oldText === undefined || newText === undefined) return null;
  if (!oldText.startsWith('-') || !newText.startsWith('+')) return null;
  const old = parseRange(oldText.slice(1));
  const next = parseRange(newText.slice(1));
  if (old === null || next === null) return null;
  return {
    oldStart: old.start,
    oldCount: old.count,
    newStart: next.start,
    newCount: next.count,
    section: body.slice(end + 3).trim(),
  };
}
