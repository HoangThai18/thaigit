// Dựng patch chỉ chứa các hunk/dòng được chọn, để stage/unstage/discard từng phần — THEO BYTE.
//
// - Stage (diff index→worktree, áp xuôi vào index): `reverse = false`.
// - Unstage (diff HEAD→index, áp ngược vào index) và Discard (diff index→worktree, áp ngược vào worktree):
//   `reverse = true`.
//
// Dòng không được chọn: khi áp xuôi, dòng xoá thành ngữ cảnh còn dòng thêm bị bỏ; khi áp ngược thì ngược lại.
// Trong mỗi khối thay đổi, dòng xoá thứ k và dòng thêm thứ k được xen kẽ theo vị trí, để "sửa dòng 2 nhưng giữ
// dòng 3" cho kết quả đúng thứ tự.
//
// Nội dung từng dòng được chép nguyên byte từ diff (kể cả "\r"), nên `git apply` tái tạo đúng từng byte.
// Gọi: `git apply --whitespace=nowarn --recount [--cached] [--reverse] -` với patch này làm stdin (không giải mã).

import { asciiBytes, concatBytes, startsWithAscii } from './bytes.ts';
import {
  type DiffHunk,
  type DiffLine,
  type DiffLineKind,
  type FileDiff,
  changeLineIndices,
  supportsPartialStaging,
} from './diff.ts';

/** id hunk → tập chỉ số dòng (trong `hunk.lines`) được chọn. */
export type LineSelection = ReadonlyMap<number, ReadonlySet<number>>;

type Marker = ' ' | '+' | '-';

interface Item {
  readonly kind: DiffLineKind;
  readonly text: Uint8Array;
  noNewline: boolean;
  readonly index: number;
}

interface Output {
  readonly marker: Marker;
  readonly text: Uint8Array;
  readonly noNewline: boolean;
}

const MARKER_BYTES: Readonly<Record<Marker, Uint8Array>> = {
  ' ': asciiBytes(' '),
  '+': asciiBytes('+'),
  '-': asciiBytes('-'),
};
const NEWLINE = asciiBytes('\n');
const CR_BYTES = asciiBytes('\r');
const NO_NEWLINE_LINE = asciiBytes('\\ No newline at end of file\n');

/**
 * @returns nội dung patch (byte), hoặc null nếu không có thay đổi nào được chọn / file không hỗ trợ stage từng phần.
 */
export function makePatch(file: FileDiff, selection: LineSelection, reverse: boolean): Uint8Array | null {
  if (!supportsPartialStaging(file)) return null;

  const header = patchHeader(file, reverse);
  if (header === null) return null;
  const parts: Uint8Array[] = [];
  for (const line of header) parts.push(line, NEWLINE);
  let delta = 0;
  let emittedAny = false;

  for (const hunk of file.hunks) {
    const selected = selection.get(hunk.id);
    if (selected === undefined || selected.size === 0) continue;
    const lines = buildLines(hunk, selected, reverse);
    if (lines === null) continue;

    const oldCount = lines.filter((line) => line.marker !== '+').length;
    const newCount = lines.filter((line) => line.marker !== '-').length;

    // "anchor" = số dòng đứng trước khoảng. Quy ước unified diff: khoảng rỗng thì start = anchor,
    // khoảng có dòng thì start = anchor + 1. Phía được giữ nguyên (old khi stage, new khi áp ngược) có đúng các
    // dòng như hunk gốc nên anchor của phía đó không đổi; phía còn lại lệch theo delta của các hunk trước.
    const originalOldAnchor = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1;
    const originalNewAnchor = hunk.newCount === 0 ? hunk.newStart : hunk.newStart - 1;
    const oldAnchor = reverse ? originalNewAnchor - delta : originalOldAnchor;
    const newAnchor = reverse ? originalNewAnchor : originalOldAnchor + delta;
    const oldStart = oldCount === 0 ? Math.max(0, oldAnchor) : oldAnchor + 1;
    const newStart = newCount === 0 ? Math.max(0, newAnchor) : newAnchor + 1;

    parts.push(asciiBytes(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`));
    for (const line of lines) {
      parts.push(MARKER_BYTES[line.marker], line.text, NEWLINE);
      if (line.noNewline) parts.push(NO_NEWLINE_LINE);
    }
    delta += newCount - oldCount;
    emittedAny = true;
  }

  return emittedAny ? concatBytes(parts) : null;
}

/** Dòng header chỉ có ở đổi tên/sao chép: không được đưa vào patch nội dung. */
const RENAME_COPY_PREFIXES = [
  'similarity index ',
  'dissimilarity index ',
  'rename from ',
  'rename to ',
  'copy from ',
  'copy to ',
];

/**
 * Header của patch. Bỏ dòng đổi mode: stage một phần nội dung không nên kéo theo đổi quyền file.
 * File đổi tên/sao chép (diff --cached -M): patch có "rename from/to" khi áp ngược sẽ ĐỔI TÊN NGƯỢC lại trong index
 * (mất b.txt khỏi index, a.txt sống lại) chứ không chỉ bỏ vài dòng — nên viết lại header thành sửa nội dung một
 * đường dẫn: đường dẫn mới khi áp ngược (unstage), đường dẫn cũ khi áp xuôi. Không đọc được tên → null (từ chối).
 */
function patchHeader(file: FileDiff, reverse: boolean): Uint8Array[] | null {
  const withoutMode = file.headerLines.filter(
    (line) => !startsWithAscii(line, 'old mode ') && !startsWithAscii(line, 'new mode '),
  );
  const renamed = file.headerLines.some((line) =>
    RENAME_COPY_PREFIXES.some((prefix) => startsWithAscii(line, prefix)),
  );
  if (!renamed) return withoutMode;

  const source = file.headerLines.find((line) => startsWithAscii(line, reverse ? '+++ ' : '--- '));
  const name = source === undefined ? null : parseNameToken(source.subarray(4), reverse ? 'b' : 'a');
  if (name === null) return null;
  const token = (side: 'a' | 'b'): Uint8Array => nameToken(side, name.quoted, name.path);
  const tab = name.tab ? asciiBytes('\t') : new Uint8Array();

  const header: Uint8Array[] = [];
  for (const line of withoutMode) {
    if (RENAME_COPY_PREFIXES.some((prefix) => startsWithAscii(line, prefix))) continue;
    if (startsWithAscii(line, 'diff --git ')) {
      header.push(concatBytes([asciiBytes('diff --git '), token('a'), asciiBytes(' '), token('b')]));
    } else if (startsWithAscii(line, '--- ')) {
      header.push(concatBytes([asciiBytes('--- '), token('a'), tab]));
    } else if (startsWithAscii(line, '+++ ')) {
      header.push(concatBytes([asciiBytes('+++ '), token('b'), tab]));
    } else {
      header.push(line);
    }
  }
  return header;
}

interface NameToken {
  /** Git đặt tên trong ngoặc kép kiểu C ("a/t\303\240i.txt"). */
  readonly quoted: boolean;
  /** Đường dẫn sau tiền tố "a/" hoặc "b/" (không gồm ngoặc kép), nguyên byte. */
  readonly path: Uint8Array;
  /** Git thêm TAB cuối dòng ---/+++ khi đường dẫn có dấu cách. */
  readonly tab: boolean;
}

/** Tách phần tên của dòng "--- a/x" / "+++ b/x" (đã bỏ 4 ký tự đầu). */
function parseNameToken(rest: Uint8Array, side: 'a' | 'b'): NameToken | null {
  const tab = rest.length > 0 && rest[rest.length - 1] === 0x09;
  const text = tab ? rest.subarray(0, rest.length - 1) : rest;
  const quoted = text.length >= 2 && text[0] === 0x22 && text[text.length - 1] === 0x22;
  const inner = quoted ? text.subarray(1, text.length - 1) : text;
  if (!startsWithAscii(inner, `${side}/`) || inner.length <= 2) return null;
  return { quoted, path: inner.subarray(2), tab };
}

function nameToken(side: 'a' | 'b', quoted: boolean, path: Uint8Array): Uint8Array {
  const quote = quoted ? asciiBytes('"') : new Uint8Array();
  return concatBytes([quote, asciiBytes(`${side}/`), path, quote]);
}

/** Chọn toàn bộ dòng thay đổi của một hunk. */
export function selectionForWholeHunk(hunk: DiffHunk): Map<number, Set<number>> {
  return new Map([[hunk.id, new Set(changeLineIndices(hunk))]]);
}

function buildLines(hunk: DiffHunk, selected: ReadonlySet<number>, reverse: boolean): Output[] | null {
  // Gộp dấu "\ No newline" vào dòng đứng trước.
  const items: Item[] = [];
  hunk.lines.forEach((line: DiffLine, index) => {
    if (line.kind === 'noNewline') {
      const previous = items[items.length - 1];
      if (previous !== undefined) previous.noNewline = true;
      return;
    }
    items.push({ kind: line.kind, text: line.text, noNewline: false, index });
  });

  const output: Output[] = [];
  let hasChange = false;
  let cursor = 0;
  while (cursor < items.length) {
    const item = items[cursor] as Item;
    if (item.kind === 'context') {
      output.push({ marker: ' ', text: item.text, noNewline: item.noNewline });
      cursor += 1;
      continue;
    }
    const deletions: Item[] = [];
    const additions: Item[] = [];
    while (cursor < items.length) {
      const next = items[cursor] as Item;
      if (next.kind === 'context') break;
      if (next.kind === 'deletion') deletions.push(next);
      else additions.push(next);
      cursor += 1;
    }
    const block: Output[] = [];
    const pairs = Math.max(deletions.length, additions.length);
    for (let k = 0; k < pairs; k++) {
      const deletion = deletions[k];
      if (deletion !== undefined) {
        if (selected.has(deletion.index)) {
          block.push({ marker: '-', text: deletion.text, noNewline: deletion.noNewline });
          hasChange = true;
        } else if (!reverse) {
          block.push({ marker: ' ', text: deletion.text, noNewline: deletion.noNewline });
        }
      }
      const addition = additions[k];
      if (addition !== undefined) {
        if (selected.has(addition.index)) {
          block.push({ marker: '+', text: addition.text, noNewline: addition.noNewline });
          hasChange = true;
        } else if (reverse) {
          block.push({ marker: ' ', text: addition.text, noNewline: addition.noNewline });
        }
      }
    }
    output.push(...keepNoNewlineChangesLast(block));
  }
  return hasChange ? fixNoNewlineContext(output) : null;
}

/**
 * Dòng thêm/xoá đã chọn mà "không có newline cuối file" phải là dòng cuối của phía của nó. Ghép cặp xen kẽ có thể
 * đặt nó TRƯỚC các dòng ngữ cảnh (từ dòng chưa chọn) cùng khối; git vẫn áp patch và nối hai dòng lại thành một
 * ("y1" + "x2" → "y1x2") nên hỏng dữ liệu âm thầm. Dời dòng đó xuống cuối khối (chỉ đổi những khối vốn đã sai).
 * Bản Swift không xử lý chỗ này.
 */
function keepNoNewlineChangesLast(block: readonly Output[]): Output[] {
  let lastOld = -1;
  let lastNew = -1;
  block.forEach((line, index) => {
    if (line.marker !== '+') lastOld = index;
    if (line.marker !== '-') lastNew = index;
  });
  const stay: Output[] = [];
  const moved: Output[] = [];
  block.forEach((line, index) => {
    const misplaced =
      line.noNewline &&
      ((line.marker === '+' && index < lastNew) || (line.marker === '-' && index < lastOld));
    (misplaced ? moved : stay).push(line);
  });
  return [...stay, ...moved];
}

/** Thêm "\r" cuối `text` nếu dòng gần nhất có xuống dòng (không phải dòng "không newline") kết thúc bằng "\r". */
function withNeighbourLineEnding(text: Uint8Array, lines: readonly Output[], index: number): Uint8Array {
  const usable = (line: Output | undefined): line is Output => line !== undefined && !line.noNewline;
  for (let distance = 1; distance < lines.length; distance++) {
    const neighbour = [lines[index - distance], lines[index + distance]].find(usable);
    if (neighbour !== undefined) {
      return neighbour.text[neighbour.text.length - 1] === 0x0d ? concatBytes([text, CR_BYTES]) : text;
    }
  }
  return text;
}

/**
 * Dòng ngữ cảnh "không có newline cuối file" chỉ hợp lệ khi là dòng cuối của cả hai phía.
 * Nếu không, tách thành cặp -/+ để mỗi phía có đúng ký tự xuống dòng. Phía vừa được thêm xuống dòng dùng kiểu
 * xuống dòng của dòng lân cận (file CRLF thì thêm "\r\n", không để lọt một "\n" lẻ như bản Swift).
 */
function fixNoNewlineContext(lines: readonly Output[]): Output[] {
  let lastOld = -1;
  let lastNew = -1;
  lines.forEach((line, index) => {
    if (line.marker !== '+') lastOld = index;
    if (line.marker !== '-') lastNew = index;
  });
  const fixed: Output[] = [];
  lines.forEach((line, index) => {
    if (line.marker !== ' ' || !line.noNewline) {
      fixed.push(line);
      return;
    }
    const isLastOld = index === lastOld;
    const isLastNew = index === lastNew;
    if (isLastOld && isLastNew) {
      fixed.push(line);
    } else if (isLastOld) {
      const gained = withNeighbourLineEnding(line.text, lines, index);
      fixed.push(
        { marker: '-', text: line.text, noNewline: true },
        { marker: '+', text: gained, noNewline: false },
      );
    } else if (isLastNew) {
      const gained = withNeighbourLineEnding(line.text, lines, index);
      fixed.push(
        { marker: '-', text: gained, noNewline: false },
        { marker: '+', text: line.text, noNewline: true },
      );
    } else {
      fixed.push({ marker: ' ', text: line.text, noNewline: false });
    }
  });
  return fixed;
}
