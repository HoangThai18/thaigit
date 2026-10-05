// Splits a conflicted file (<<<<<<< ======= >>>>>>>) into common and conflict segments — BYTE-ORIENTED.
//
// Safety rules (deliberately stricter than the Swift version):
//  - Resolve in-app only when the whole file is valid UTF-8; otherwise return `not-utf8` so the UI can only offer
//    "Open in editor", and there is no path that rewrites the file through a decode.
//  - A UTF-8 BOM and each line's own terminator style are preserved (mixed CRLF/LF files stay byte-exact).
//  - Saving replaces only the bytes inside conflict regions; every other byte is copied verbatim.

import {
  UTF8_BOM_LENGTH,
  type LineEnding,
  decodeUtf8Lossy,
  decodeUtf8Strict,
  detectLineEnding,
  hasUtf8Bom,
} from '../support/text.ts';
import { CR, LF, type LineSpan, concatBytes, splitLineSpans } from './bytes.ts';

export type ConflictResolution = 'ours' | 'theirs' | 'oursThenTheirs' | 'theirsThenOurs' | 'base' | 'neither';

export const conflictResolutions: readonly ConflictResolution[] = [
  'ours',
  'theirs',
  'oursThenTheirs',
  'theirsThenOurs',
  'base',
  'neither',
];

/** Byte range [start, end) in the original file. */
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

export interface ConflictBlock {
  readonly id: number;
  readonly oursLabel: string;
  readonly theirsLabel: string;
  readonly baseLabel: string | null;
  /** Lines to display (without their terminator). */
  readonly ours: readonly string[];
  readonly base: readonly string[] | null;
  readonly theirs: readonly string[];
  /** From the <<<<<<< line start through the end of the >>>>>>> line (terminator included): the only region replaced on save. */
  readonly region: ByteRange;
  /** Verbatim bytes of each side (including each line's terminator). */
  readonly oursBytes: ByteRange;
  readonly baseBytes: ByteRange | null;
  readonly theirsBytes: ByteRange;
  /** Bytes of each line on each side (terminator included) — used for per-line selection, like GitKraken. */
  readonly oursLineBytes: readonly ByteRange[];
  readonly theirsLineBytes: readonly ByteRange[];
}

export type ConflictSegment =
  | { readonly kind: 'common'; readonly lines: readonly string[]; readonly range: ByteRange }
  | { readonly kind: 'conflict'; readonly block: ConflictBlock };

export interface ConflictFile {
  /** Original content (kept by reference, never mutated) — the source for reassembling on save. */
  readonly bytes: Uint8Array;
  readonly hasBom: boolean;
  readonly segments: readonly ConflictSegment[];
  /** Conflict blocks in order (same objects as in `segments`). */
  readonly blocks: readonly ConflictBlock[];
  readonly lineEnding: LineEnding;
  readonly endsWithNewline: boolean;
}

export type ConflictParseResult =
  | { readonly ok: true; readonly file: ConflictFile }
  /** Not valid UTF-8 (CP1252, CP1258, UTF-16…): never resolved in-app, only opened in an external editor. */
  | { readonly ok: false; readonly reason: 'not-utf8' };

/** Per-line selection: ticked Current lines first, then ticked Incoming lines, keeping file order. */
export interface ConflictLinePick {
  readonly kind: 'lines';
  readonly ours: ReadonlySet<number>;
  readonly theirs: ReadonlySet<number>;
}

/** A segment's selection: one whole side, or individual lines. */
export type ConflictChoice = ConflictResolution | ConflictLinePick;

export type ConflictChoices = ReadonlyMap<number, ConflictChoice>;

const MARKER_LENGTH = 7;
const LESS_THAN = 0x3c; // <
const PIPE = 0x7c; // |
const EQUALS = 0x3d; // =
const GREATER_THAN = 0x3e; // >
const SPACE = 0x20;

/** Exactly 7 `code` chars, then end of line or a space plus a label. Returns the label, or null when it is not a marker. */
function matchMarker(bytes: Uint8Array, span: LineSpan, code: number): string | null {
  const length = span.contentEnd - span.start;
  if (length < MARKER_LENGTH) return null;
  for (let i = 0; i < MARKER_LENGTH; i++) {
    if (bytes[span.start + i] !== code) return null;
  }
  if (length === MARKER_LENGTH) return '';
  if (bytes[span.start + MARKER_LENGTH] !== SPACE) return null;
  return decodeUtf8Lossy(bytes.subarray(span.start + MARKER_LENGTH + 1, span.contentEnd));
}

function lineTexts(bytes: Uint8Array, spans: readonly LineSpan[], from: number, to: number): string[] {
  const lines: string[] = [];
  for (let i = from; i < to; i++) {
    const span = spans[i] as LineSpan;
    lines.push(decodeUtf8Lossy(bytes.subarray(span.start, span.contentEnd)));
  }
  return lines;
}

function lineRanges(spans: readonly LineSpan[], from: number, to: number): ByteRange[] {
  const ranges: ByteRange[] = [];
  for (let i = from; i < to; i++) {
    const span = spans[i] as LineSpan;
    ranges.push({ start: span.start, end: span.end });
  }
  return ranges;
}

/** Byte offset of line `index`; an `index` equal to the line count is end of file. */
function offsetOf(spans: readonly LineSpan[], index: number, endOfFile: number): number {
  return spans[index]?.start ?? endOfFile;
}

export function parseConflictFile(bytes: Uint8Array): ConflictParseResult {
  if (decodeUtf8Strict(bytes) === null) return { ok: false, reason: 'not-utf8' };

  const hasBom = hasUtf8Bom(bytes);
  const spans = splitLineSpans(bytes, hasBom ? UTF8_BOM_LENGTH : 0);
  const segments: ConflictSegment[] = [];
  const blocks: ConflictBlock[] = [];

  let commonFrom = 0; // start of the common segment being gathered
  let index = 0;
  while (index < spans.length) {
    const startSpan = spans[index] as LineSpan;
    const oursLabel = matchMarker(bytes, startSpan, LESS_THAN);
    if (oursLabel === null) {
      index += 1;
      continue;
    }

    // Require a complete block structure; otherwise treat the <<<<<<< line as ordinary text.
    let stage = 0; // 0: ours, 1: base, 2: theirs
    let baseMarker = -1;
    let baseLabel: string | null = null;
    let separator = -1;
    let theirsLabel: string | null = null;
    let closing = -1;
    for (let cursor = index + 1; cursor < spans.length; cursor++) {
      const current = spans[cursor] as LineSpan;
      const pipeLabel = stage === 0 ? matchMarker(bytes, current, PIPE) : null;
      if (pipeLabel !== null) {
        stage = 1;
        baseMarker = cursor;
        baseLabel = pipeLabel;
      } else if (stage < 2 && matchMarker(bytes, current, EQUALS) === '') {
        stage = 2;
        separator = cursor;
      } else {
        const closeLabel = stage === 2 ? matchMarker(bytes, current, GREATER_THAN) : null;
        if (closeLabel !== null) {
          theirsLabel = closeLabel;
          closing = cursor;
          break;
        }
        // Another <<<<<<< before the close: this block is incomplete.
        if (matchMarker(bytes, current, LESS_THAN) !== null) break;
      }
    }
    if (closing === -1 || theirsLabel === null) {
      index += 1;
      continue;
    }

    if (commonFrom < index) {
      segments.push({
        kind: 'common',
        lines: lineTexts(bytes, spans, commonFrom, index),
        range: { start: offsetOf(spans, commonFrom, bytes.length), end: startSpan.start },
      });
    }
    const oursEnd = baseMarker === -1 ? separator : baseMarker;
    const block: ConflictBlock = {
      id: blocks.length,
      oursLabel,
      theirsLabel,
      baseLabel,
      ours: lineTexts(bytes, spans, index + 1, oursEnd),
      base: baseMarker === -1 ? null : lineTexts(bytes, spans, baseMarker + 1, separator),
      theirs: lineTexts(bytes, spans, separator + 1, closing),
      region: { start: startSpan.start, end: (spans[closing] as LineSpan).end },
      oursBytes: {
        start: offsetOf(spans, index + 1, bytes.length),
        end: offsetOf(spans, oursEnd, bytes.length),
      },
      baseBytes:
        baseMarker === -1
          ? null
          : {
              start: offsetOf(spans, baseMarker + 1, bytes.length),
              end: offsetOf(spans, separator, bytes.length),
            },
      theirsBytes: {
        start: offsetOf(spans, separator + 1, bytes.length),
        end: offsetOf(spans, closing, bytes.length),
      },
      oursLineBytes: lineRanges(spans, index + 1, oursEnd),
      theirsLineBytes: lineRanges(spans, separator + 1, closing),
    };
    blocks.push(block);
    segments.push({ kind: 'conflict', block });
    index = closing + 1;
    commonFrom = index;
  }
  if (commonFrom < spans.length) {
    segments.push({
      kind: 'common',
      lines: lineTexts(bytes, spans, commonFrom, spans.length),
      range: { start: offsetOf(spans, commonFrom, bytes.length), end: bytes.length },
    });
  }

  return {
    ok: true,
    file: {
      bytes,
      hasBom,
      segments,
      blocks,
      lineEnding: detectLineEnding(bytes),
      endsWithNewline: bytes.length > 0 && bytes[bytes.length - 1] === LF,
    },
  };
}

/** Length in bytes of the line terminator at the end of `range` ("\n" = 1, "\r\n" = 2, none = 0). */
function terminatorLength(bytes: Uint8Array, range: ByteRange): number {
  if (range.end <= range.start || bytes[range.end - 1] !== LF) return 0;
  return range.end - 2 >= range.start && bytes[range.end - 2] === CR ? 2 : 1;
}

function rangesFor(block: ConflictBlock, choice: ConflictChoice): ByteRange[] {
  if (typeof choice !== 'string') {
    const pick = (lines: readonly ByteRange[], picked: ReadonlySet<number>): ByteRange[] =>
      [...picked].sort((a, b) => a - b).flatMap((index) => (lines[index] ? [lines[index]] : []));
    return [...pick(block.oursLineBytes, choice.ours), ...pick(block.theirsLineBytes, choice.theirs)];
  }
  switch (choice) {
    case 'ours':
      return [block.oursBytes];
    case 'theirs':
      return [block.theirsBytes];
    case 'oursThenTheirs':
      return [block.oursBytes, block.theirsBytes];
    case 'theirsThenOurs':
      return [block.theirsBytes, block.oursBytes];
    case 'base':
      return block.baseBytes === null ? [] : [block.baseBytes];
    case 'neither':
      return [];
  }
}

/** Line on each side present in a selection (used to highlight chosen lines). */
export function conflictLineSets(
  choice: ConflictChoice | undefined,
  block: ConflictBlock,
): { ours: Set<number>; theirs: Set<number> } {
  const all = (lines: readonly string[]) => new Set(lines.map((_, index) => index));
  if (choice === undefined) return { ours: new Set(), theirs: new Set() };
  if (typeof choice !== 'string') return { ours: new Set(choice.ours), theirs: new Set(choice.theirs) };
  switch (choice) {
    case 'ours':
      return { ours: all(block.ours), theirs: new Set() };
    case 'theirs':
      return { ours: new Set(), theirs: all(block.theirs) };
    case 'oursThenTheirs':
    case 'theirsThenOurs':
      return { ours: all(block.ours), theirs: all(block.theirs) };
    default:
      return { ours: new Set(), theirs: new Set() };
  }
}

/** Toggle a line, starting from the current selection (selecting a whole side counts as ticking all its lines). */
export function toggleConflictLine(
  current: ConflictChoice | undefined,
  block: ConflictBlock,
  side: 'ours' | 'theirs',
  line: number,
): ConflictLinePick {
  const sets = conflictLineSets(current, block);
  const target = sets[side];
  if (target.has(line)) target.delete(line);
  else target.add(line);
  return { kind: 'lines', ours: sets.ours, theirs: sets.theirs };
}

/** Merge according to the existing selections; unselected segments stay as-is (conflict markers included) — a preview before saving. */
export function previewConflicts(file: ConflictFile, choices: ConflictChoices): Uint8Array {
  return assemble(file, choices, true) as Uint8Array;
}

/**
 * Reassemble the file content (bytes) from the per-block selections; null while any block is still unselected.
 * Every byte outside a conflict region (the BOM included) is copied verbatim. If the final >>>>>>> line has no
 * terminator, the result has no trailing terminator either (preserving the original end-of-file state).
 */
export function resolveConflicts(file: ConflictFile, choices: ConflictChoices): Uint8Array | null {
  return assemble(file, choices, false);
}

function assemble(file: ConflictFile, choices: ConflictChoices, keepUnresolved: boolean): Uint8Array | null {
  const { bytes } = file;
  const parts: Uint8Array[] = [];
  if (file.hasBom) parts.push(bytes.subarray(0, UTF8_BOM_LENGTH));
  for (const segment of file.segments) {
    if (segment.kind === 'common') {
      parts.push(bytes.subarray(segment.range.start, segment.range.end));
      continue;
    }
    const { block } = segment;
    const choice = choices.get(block.id);
    if (choice === undefined) {
      if (!keepUnresolved) return null;
      parts.push(bytes.subarray(block.region.start, block.region.end));
      continue;
    }
    const ranges = rangesFor(block, choice).filter((range) => range.end > range.start);
    const unterminatedTail = block.region.end === bytes.length && !file.endsWithNewline;
    ranges.forEach((range, position) => {
      const strip = unterminatedTail && position === ranges.length - 1 ? terminatorLength(bytes, range) : 0;
      parts.push(bytes.subarray(range.start, range.end - strip));
    });
  }
  return concatBytes(parts);
}
