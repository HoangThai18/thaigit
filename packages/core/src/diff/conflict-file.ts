// File có dấu xung đột (<<<<<<< ======= >>>>>>>), tách thành các đoạn chung và đoạn xung đột — THEO BYTE.
//
// Quy tắc an toàn (khác bản Swift có chủ đích):
//  - Chỉ giải trong app khi toàn bộ file là UTF-8 hợp lệ; ngược lại trả `not-utf8` để UI chỉ cho "Mở bằng editor"
//    và không có đường nào ghi lại file qua giải mã.
//  - BOM UTF-8 và kiểu xuống dòng của TỪNG dòng được giữ nguyên (file lẫn CRLF/LF vẫn đúng từng byte).
//  - Khi lưu, chỉ thay phần byte nằm trong vùng khối xung đột; mọi byte ngoài vùng đó chép nguyên văn.

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

/** Khoảng byte [start, end) trong file gốc. */
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

export interface ConflictBlock {
  readonly id: number;
  readonly oursLabel: string;
  readonly theirsLabel: string;
  readonly baseLabel: string | null;
  /** Các dòng để hiển thị (không gồm ký tự xuống dòng). */
  readonly ours: readonly string[];
  readonly base: readonly string[] | null;
  readonly theirs: readonly string[];
  /** Từ đầu dòng <<<<<<< đến hết dòng >>>>>>> (gồm xuống dòng): vùng duy nhất bị thay khi lưu. */
  readonly region: ByteRange;
  /** Byte nguyên văn của từng phía (gồm ký tự xuống dòng của từng dòng). */
  readonly oursBytes: ByteRange;
  readonly baseBytes: ByteRange | null;
  readonly theirsBytes: ByteRange;
}

export type ConflictSegment =
  | { readonly kind: 'common'; readonly lines: readonly string[]; readonly range: ByteRange }
  | { readonly kind: 'conflict'; readonly block: ConflictBlock };

export interface ConflictFile {
  /** Nội dung gốc (giữ tham chiếu, không sửa) — nguồn để ghép lại khi lưu. */
  readonly bytes: Uint8Array;
  readonly hasBom: boolean;
  readonly segments: readonly ConflictSegment[];
  /** Các khối xung đột theo thứ tự (cùng đối tượng với trong `segments`). */
  readonly blocks: readonly ConflictBlock[];
  readonly lineEnding: LineEnding;
  readonly endsWithNewline: boolean;
}

export type ConflictParseResult =
  | { readonly ok: true; readonly file: ConflictFile }
  /** Không phải UTF-8 hợp lệ (CP1252, CP1258, UTF-16…): không giải trong app, chỉ mở bằng editor ngoài. */
  | { readonly ok: false; readonly reason: 'not-utf8' };

export type ConflictChoices = ReadonlyMap<number, ConflictResolution>;

const MARKER_LENGTH = 7;
const LESS_THAN = 0x3c; // <
const PIPE = 0x7c; // |
const EQUALS = 0x3d; // =
const GREATER_THAN = 0x3e; // >
const SPACE = 0x20;

/** Đúng 7 ký tự `code`, rồi hết dòng hoặc một dấu cách + nhãn. Trả nhãn, hoặc null nếu không phải dấu. */
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

/** Mốc byte đầu dòng `index`; `index` = số dòng thì là cuối file. */
function offsetOf(spans: readonly LineSpan[], index: number, endOfFile: number): number {
  return spans[index]?.start ?? endOfFile;
}

export function parseConflictFile(bytes: Uint8Array): ConflictParseResult {
  if (decodeUtf8Strict(bytes) === null) return { ok: false, reason: 'not-utf8' };

  const hasBom = hasUtf8Bom(bytes);
  const spans = splitLineSpans(bytes, hasBom ? UTF8_BOM_LENGTH : 0);
  const segments: ConflictSegment[] = [];
  const blocks: ConflictBlock[] = [];

  let commonFrom = 0; // dòng đầu của đoạn chung đang gom
  let index = 0;
  while (index < spans.length) {
    const startSpan = spans[index] as LineSpan;
    const oursLabel = matchMarker(bytes, startSpan, LESS_THAN);
    if (oursLabel === null) {
      index += 1;
      continue;
    }

    // Tìm cấu trúc block hoàn chỉnh; nếu không đủ thì coi dòng <<<<<<< như văn bản thường.
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
        // Gặp <<<<<<< khác trước khi đóng: khối này không hoàn chỉnh.
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

/** Độ dài ký tự xuống dòng ở cuối `range` ("\n" = 1, "\r\n" = 2, không có = 0). */
function terminatorLength(bytes: Uint8Array, range: ByteRange): number {
  if (range.end <= range.start || bytes[range.end - 1] !== LF) return 0;
  return range.end - 2 >= range.start && bytes[range.end - 2] === CR ? 2 : 1;
}

function rangesFor(block: ConflictBlock, choice: ConflictResolution): ByteRange[] {
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

/**
 * Ghép lại nội dung file (byte) theo lựa chọn cho từng block; null nếu còn block chưa chọn.
 * Mọi byte ngoài vùng xung đột (kể cả BOM) chép nguyên văn. Nếu dòng >>>>>>> cuối file không có xuống dòng
 * thì kết quả cũng không có xuống dòng cuối (giữ trạng thái cuối file như bản gốc).
 */
export function resolveConflicts(file: ConflictFile, choices: ConflictChoices): Uint8Array | null {
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
    if (choice === undefined) return null;
    const ranges = rangesFor(block, choice).filter((range) => range.end > range.start);
    const unterminatedTail = block.region.end === bytes.length && !file.endsWithNewline;
    ranges.forEach((range, position) => {
      const strip = unterminatedTail && position === ranges.length - 1 ? terminatorLength(bytes, range) : 0;
      parts.push(bytes.subarray(range.start, range.end - strip));
    });
  }
  return concatBytes(parts);
}
