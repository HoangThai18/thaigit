// Tô sáng phần thay đổi bên trong một dòng (so cặp dòng xoá/thêm liền kề). Chỉ để hiển thị: làm việc trên chuỗi
// đã giải mã, không liên quan tới byte của patch.

import { decodeUtf8Lossy, isGraphemeBoundary } from '../support/text.ts';
import type { DiffHunk, DiffLineKind } from './diff.ts';

/**
 * Khoảng [start, end) theo UTF-16 code unit của chuỗi (dùng thẳng với `String.slice`), luôn nằm trên ranh giới
 * grapheme nên không xé cặp thay thế hay chữ + dấu kết hợp. Với chữ ASCII trùng với chỉ số ký tự của bản Swift.
 */
export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export interface InlineLine {
  readonly kind: DiffLineKind;
  readonly text: string;
}

/** Dòng dài hơn mức này thì bỏ qua tô từng phần. */
const MAX_INLINE_LENGTH = 2000;
/** Phần giống nhau (đầu + cuối) chiếm dưới tỉ lệ này thì tô cả dòng là đủ. */
const MIN_COMMON_RATIO = 0.3;

/** Khoảng khác nhau giữa hai dòng; null nếu hai dòng khác nhau quá nhiều hoặc giống hệt. */
export function changedRanges(oldText: string, newText: string): { old: TextRange; new: TextRange } | null {
  const oldLength = oldText.length;
  const newLength = newText.length;
  if (
    (oldLength === 0 && newLength === 0) ||
    oldLength >= MAX_INLINE_LENGTH ||
    newLength >= MAX_INLINE_LENGTH
  ) {
    return null;
  }
  const shortest = Math.min(oldLength, newLength);

  let prefix = 0;
  while (prefix < shortest && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix += 1;
  while (prefix > 0 && !(isGraphemeBoundary(oldText, prefix) && isGraphemeBoundary(newText, prefix)))
    prefix -= 1;

  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    oldText.charCodeAt(oldLength - 1 - suffix) === newText.charCodeAt(newLength - 1 - suffix)
  ) {
    suffix += 1;
  }
  while (
    suffix > 0 &&
    !(isGraphemeBoundary(oldText, oldLength - suffix) && isGraphemeBoundary(newText, newLength - suffix))
  ) {
    suffix -= 1;
  }

  const longest = Math.max(oldLength, newLength);
  if (longest === 0 || (prefix + suffix) / longest < MIN_COMMON_RATIO) return null;
  const oldRange = { start: prefix, end: oldLength - suffix };
  const newRange = { start: prefix, end: newLength - suffix };
  if (oldRange.start === oldRange.end && newRange.start === newRange.end) return null;
  return { old: oldRange, new: newRange };
}

/** Chỉ số dòng trong hunk → khoảng cần tô đậm. Ghép dòng xoá thứ k với dòng thêm thứ k trong mỗi khối thay đổi. */
export function inlineHighlights(lines: readonly InlineLine[]): Map<number, TextRange> {
  const result = new Map<number, TextRange>();
  let i = 0;
  while (i < lines.length) {
    if (lines[i]?.kind !== 'deletion') {
      i += 1;
      continue;
    }
    const deletions: number[] = [];
    while (i < lines.length) {
      const kind = lines[i]?.kind;
      if (kind !== 'deletion' && kind !== 'noNewline') break;
      if (kind === 'deletion') deletions.push(i);
      i += 1;
    }
    const additions: number[] = [];
    while (i < lines.length) {
      const kind = lines[i]?.kind;
      if (kind !== 'addition' && kind !== 'noNewline') break;
      if (kind === 'addition') additions.push(i);
      i += 1;
    }
    const pairs = Math.min(deletions.length, additions.length);
    for (let k = 0; k < pairs; k++) {
      const d = deletions[k] as number;
      const a = additions[k] as number;
      const ranges = changedRanges(lines[d]?.text ?? '', lines[a]?.text ?? '');
      if (ranges !== null) {
        result.set(d, ranges.old);
        result.set(a, ranges.new);
      }
    }
  }
  return result;
}

/** Như `inlineHighlights` nhưng trên hunk thô (giải mã lỏng, chưa đổi tab) — dùng khi không cần chữ hiển thị. */
export function hunkHighlights(hunk: DiffHunk): Map<number, TextRange> {
  return inlineHighlights(hunk.lines.map((line) => ({ kind: line.kind, text: decodeUtf8Lossy(line.text) })));
}
