// Builds a patch containing only the selected hunks/lines, for per-hunk and per-line stage/unstage/discard —
// BYTE-ORIENTED.
//
// - Stage (index→worktree diff, applied forward into the index): `reverse = false`.
// - Unstage (HEAD→index diff, applied in reverse into the index) and Discard (index→worktree diff, applied in reverse
//   into the worktree): `reverse = true`.
//
// Unselected lines: when applying forward, deleted lines become context and added lines are dropped; when applying in
// reverse it is the other way round. Within a change block the k-th deleted and k-th added line are interleaved by
// position, so "edit line 2 but keep line 3" produces the right order.
//
// Each line's content is copied byte-for-byte from the diff ("\r" included), so `git apply` reproduces the file exactly.
// Call with: `git apply --whitespace=nowarn --recount [--cached] [--reverse] -`, this patch as stdin (no decoding).

import { asciiBytes, concatBytes, startsWithAscii } from './bytes.ts';
import {
  type DiffHunk,
  type DiffLine,
  type DiffLineKind,
  type FileDiff,
  changeLineIndices,
  supportsPartialStaging,
} from './diff.ts';

/** hunk id → set of selected line indices (within `hunk.lines`). */
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
 * @returns patch content (bytes), or null when nothing is selected or the file does not support partial staging.
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

    // "anchor" = line count before the range. Unified diff convention: an empty range means start = anchor, a range
    // with lines means start = anchor + 1. The kept side (old for stage, new when applying in reverse) has exactly the
    // lines of the original hunk, so its anchor is unchanged; the other side shifts by the delta of earlier hunks.
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

/** Header line only present for renames/copies: must not end up in the patch body. */
const RENAME_COPY_PREFIXES = [
  'similarity index ',
  'dissimilarity index ',
  'rename from ',
  'rename to ',
  'copy from ',
  'copy to ',
];

/**
 * Patch header. The mode-change line is dropped: staging part of a file's content should not drag along a mode change.
 * For renames/copies (`diff --cached -M`) the patch carries "rename from/to", and applying it in reverse would RENAME
 * BACK in the index (b.txt leaves the index, a.txt comes back) instead of just dropping a few lines — so rewrite the
 * header into a single-path content edit: the new path when applying in reverse (unstage), the old path when applying
 * forward. Unparseable names → null (refuse).
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
  /** Git quotes names in C style ("a/t\303\240i.txt"). */
  readonly quoted: boolean;
  /** Path after the "a/" or "b/" prefix (quotes stripped), raw bytes. */
  readonly path: Uint8Array;
  /** Git appends a TAB to ---/+++ lines when the path contains spaces. */
  readonly tab: boolean;
}

/** Extract the name part of a "--- a/x" / "+++ b/x" line (4 leading chars already removed). */
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

/** Select every change line of a hunk. */
export function selectionForWholeHunk(hunk: DiffHunk): Map<number, Set<number>> {
  return new Map([[hunk.id, new Set(changeLineIndices(hunk))]]);
}

function buildLines(hunk: DiffHunk, selected: ReadonlySet<number>, reverse: boolean): Output[] | null {
  // Merge a trailing "\ No newline" marker into the preceding line.
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
 * A selected added/deleted line marked "no newline at end of file" must end up last on its own side. Interleaving can
 * place it BEFORE unselected context lines of the same block; git then still applies the patch and joins the two lines
 * into one ("y1" + "x2" → "y1x2"), silently corrupting data. Move such a line to the end of its block (only blocks
 * that were already wrong are changed).
 * The Swift version does not handle this.
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

/** Append "\r" to `text` when the nearest preceding line (excluding a "no newline" line) ends with "\r". */
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
 * A "no newline at end of file" context line is only valid when it is the last line on both sides.
 * Otherwise split it into a -/+ pair so each side gets its own terminator. The side that just gained a newline uses
 * the neighbouring line's style (a CRLF file gets "\r\n", never a lone "\n" as in the Swift version).
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
