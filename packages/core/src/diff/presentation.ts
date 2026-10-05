// Pre-computed data for drawing a diff (calculated off the main thread): display text (tabs → spaces), the bold
// ranges inside a line, and deleted/added line pairs for two-column mode. DISPLAY ONLY: UTF-8 is decoded lossily and
// the trailing "\r" is dropped — never build a patch or write a file from this (patches use the bytes in `FileDiff`).

import { codePointLength, decodeUtf8Lossy, truncateCodePoints } from '../support/text.ts';
import type { DiffLineKind, FileDiff } from './diff.ts';
import { type TextRange, inlineHighlights } from './inline-diff.ts';

export const MAX_DISPLAY_LENGTH = 1_200;

export interface PresentationLine {
  /** Line index in `hunk.lines` (used as the key for per-line selection in `makePatch`). */
  readonly index: number;
  readonly kind: DiffLineKind;
  readonly text: string;
  readonly oldNumber: number | null;
  readonly newNumber: number | null;
  readonly highlight: TextRange | null;
}

export interface SplitRow {
  readonly left: PresentationLine | null;
  readonly right: PresentationLine | null;
}

export interface PresentationHunk {
  readonly id: number;
  readonly header: string;
  readonly lines: readonly PresentationLine[];
  readonly splitRows: readonly SplitRow[];
}

export interface DiffPresentation {
  readonly diff: FileDiff;
  readonly hunks: readonly PresentationHunk[];
  /** Code point length of the longest line (after tab expansion and truncation) — used to size the horizontal scroll. */
  readonly maxLineLength: number;
  readonly maxLineNumber: number;
}

export function buildPresentation(diff: FileDiff): DiffPresentation {
  const hunks: PresentationHunk[] = [];
  let maxLength = 0;
  let maxNumber = 0;
  for (const hunk of diff.hunks) {
    const texts = hunk.lines.map((line) => displayText(decodeUtf8Lossy(line.text)));
    // Bold ranges are computed on the tab-expanded text so they match display positions.
    const highlights = inlineHighlights(
      hunk.lines.map((line, index) => ({ kind: line.kind, text: texts[index] ?? '' })),
    );
    const lines: PresentationLine[] = hunk.lines.map((line, index) => {
      const text = texts[index] ?? '';
      maxLength = Math.max(maxLength, codePointLength(text));
      maxNumber = Math.max(maxNumber, line.oldNumber ?? 0, line.newNumber ?? 0);
      return {
        index,
        kind: line.kind,
        text,
        oldNumber: line.oldNumber,
        newNumber: line.newNumber,
        highlight: highlights.get(index) ?? null,
      };
    });
    hunks.push({ id: hunk.id, header: hunk.header, lines, splitRows: buildSplitRows(lines) });
  }
  return { diff, hunks, maxLineLength: maxLength, maxLineNumber: maxNumber };
}

/** Tabs → 4 spaces, trailing "\r" dropped (CRLF files), over-long lines truncated. */
export function displayText(text: string): string {
  let value = text.replaceAll('\t', '    ');
  if (value.endsWith('\r')) value = value.slice(0, -1);
  if (value.length > MAX_DISPLAY_LENGTH && codePointLength(value) > MAX_DISPLAY_LENGTH) {
    value = `${truncateCodePoints(value, MAX_DISPLAY_LENGTH)} …`;
  }
  return value;
}

/** Pairs the k-th deleted line with the k-th added line in each change block. */
export function buildSplitRows(lines: readonly PresentationLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] as PresentationLine;
    if (line.kind === 'context') {
      rows.push({ left: line, right: line });
      index += 1;
      continue;
    }
    if (line.kind === 'noNewline') {
      index += 1;
      continue;
    }
    const deletions: PresentationLine[] = [];
    const additions: PresentationLine[] = [];
    while (index < lines.length) {
      const current = lines[index] as PresentationLine;
      if (current.kind === 'context') break;
      if (current.kind === 'deletion') deletions.push(current);
      else if (current.kind === 'addition') additions.push(current);
      index += 1;
    }
    const pairs = Math.max(deletions.length, additions.length);
    for (let k = 0; k < pairs; k++) {
      rows.push({ left: deletions[k] ?? null, right: additions[k] ?? null });
    }
  }
  return rows;
}
