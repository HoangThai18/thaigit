// Highlights changed regions inside a line (by pairing adjacent deleted/added lines). Display only: it works on
// already-decoded strings and is unrelated to patch bytes.

import { decodeUtf8Lossy, isGraphemeBoundary } from '../support/text.ts';
import type { DiffHunk, DiffLineKind } from './diff.ts';

/**
 * [start, end) range in UTF-16 code units of the string (usable directly with `String.slice`). Always on grapheme
 * boundaries, so it never splits a surrogate pair or a base character from its combining mark. For ASCII this is the
 * same as the Swift character index.
 */
export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export interface InlineLine {
  readonly kind: DiffLineKind;
  readonly text: string;
}

/** Lines longer than this skip inline highlighting. */
const MAX_INLINE_LENGTH = 2000;
/** When the common prefix+suffix covers less than this ratio, highlight the whole line instead. */
const MIN_COMMON_RATIO = 0.3;

/** Range of difference between two lines; null when they differ too much or are identical. */
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

/** Line index in a hunk → range to emphasise. Pairs the k-th deleted line with the k-th added line in each change block. */
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

/** Like `inlineHighlights` but over the raw hunk (lossily decoded, tabs unexpanded) — for when display text is not needed. */
export function hunkHighlights(hunk: DiffHunk): Map<number, TextRange> {
  return inlineHighlights(hunk.lines.map((line) => ({ kind: line.kind, text: decodeUtf8Lossy(line.text) })));
}
