// Byte-level text decoding/encoding: strict and lossy UTF-8, BOM, line terminators, and git's C-style quoted paths.
// Runnable anywhere (Node, webview, worker): no `node:` imports.

const lossyDecoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
const strictDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

/** Lossy decode (display only): invalid bytes become U+FFFD, a BOM stays as U+FEFF. Never throws. */
export function decodeUtf8Lossy(bytes: Uint8Array): string {
  return lossyDecoder.decode(bytes);
}

/**
 * Strict decode: `null` when the bytes are not valid UTF-8 (CP1252, CP1258, UTF-16…). A BOM stays as U+FEFF.
 * This is the gate for whether a file may be edited in-app — a file that fails it is never written back.
 */
export function decodeUtf8Strict(bytes: Uint8Array): string | null {
  try {
    return strictDecoder.decode(bytes);
  } catch {
    return null;
  }
}

export function isValidUtf8(bytes: Uint8Array): boolean {
  return decodeUtf8Strict(bytes) !== null;
}

export function encodeUtf8(text: string): Uint8Array {
  return encoder.encode(text);
}

// MARK: - BOM

export const UTF8_BOM_LENGTH = 3;

export function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= UTF8_BOM_LENGTH && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

// MARK: - Line terminators

export interface LineEndingCounts {
  /** Count of "\r\n". */
  crlf: number;
  /** Count of bare "\n" (no "\r" right before it). */
  lf: number;
}

export function countLineEndings(bytes: Uint8Array): LineEndingCounts {
  let crlf = 0;
  let lf = 0;
  let index = bytes.indexOf(0x0a);
  while (index !== -1) {
    if (index > 0 && bytes[index - 1] === 0x0d) crlf += 1;
    else lf += 1;
    index = bytes.indexOf(0x0a, index + 1);
  }
  return { crlf, lf };
}

export type LineEnding = 'none' | 'lf' | 'crlf' | 'mixed';

/** `none` = no line terminators at all; `mixed` = both "\r\n" and bare "\n". */
export function detectLineEnding(bytes: Uint8Array): LineEnding {
  const { crlf, lf } = countLineEndings(bytes);
  if (crlf === 0 && lf === 0) return 'none';
  if (crlf === 0) return 'lf';
  return lf === 0 ? 'crlf' : 'mixed';
}

// MARK: - Display characters

let segmenterCache: Intl.Segmenter | null | undefined;

function graphemeSegmenter(): Intl.Segmenter | null {
  if (segmenterCache === undefined) {
    segmenterCache =
      typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null;
  }
  return segmenterCache;
}

/**
 * Is `offset` (in UTF-16 units) exactly on a grapheme boundary — i.e. it never cuts a surrogate pair or separates a base
 * character from its combining mark? Marks below U+0300 never join the preceding character (except after "\r\n").
 */
export function isGraphemeBoundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return true;
  const right = text.charCodeAt(offset);
  const left = text.charCodeAt(offset - 1);
  if (right < 0x300 && left < 0x300) return !(left === 0x0d && right === 0x0a);
  const segmenter = graphemeSegmenter();
  if (segmenter) return segmenter.segment(text).containing(offset)?.index === offset;
  // No Intl.Segmenter: at least avoid cutting surrogate pairs.
  return !(left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff);
}

/** Code point count (an approximation of display cells; faster than counting graphemes). */
export function codePointLength(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i += 1;
    }
    count += 1;
  }
  return count;
}

/** Truncate to at most `max` code points, backing up to the nearest grapheme boundary so no character is split. */
export function truncateCodePoints(text: string, max: number): string {
  if (text.length <= max) return text;
  let units = 0;
  let count = 0;
  while (units < text.length && count < max) {
    const code = text.charCodeAt(units);
    const pair = code >= 0xd800 && code <= 0xdbff && units + 1 < text.length;
    units += pair && text.charCodeAt(units + 1) >= 0xdc00 && text.charCodeAt(units + 1) <= 0xdfff ? 2 : 1;
    count += 1;
  }
  if (units >= text.length) return text;
  while (units > 0 && !isGraphemeBoundary(text, units)) units -= 1;
  return text.slice(0, units);
}

// MARK: - Git paths

/** Decode a git C-style quoted path ("a\tb\"c", "\303\251"). No quotes → returned unchanged. */
export function unquoteGitPath(value: string): string {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value;
  const inner = encoder.encode(value.slice(1, -1));
  const bytes: number[] = [];
  let i = 0;
  while (i < inner.length) {
    const c = inner[i] as number;
    const n = inner[i + 1];
    if (c !== 0x5c || n === undefined) {
      bytes.push(c);
      i += 1;
      continue;
    }
    switch (n) {
      case 0x6e:
        bytes.push(0x0a);
        i += 2;
        break; // \n
      case 0x74:
        bytes.push(0x09);
        i += 2;
        break; // \t
      case 0x72:
        bytes.push(0x0d);
        i += 2;
        break; // \r
      case 0x22:
        bytes.push(0x22);
        i += 2;
        break; // \"
      case 0x5c:
        bytes.push(0x5c);
        i += 2;
        break; // \\
      case 0x61:
        bytes.push(0x07);
        i += 2;
        break; // \a
      case 0x62:
        bytes.push(0x08);
        i += 2;
        break; // \b
      case 0x66:
        bytes.push(0x0c);
        i += 2;
        break; // \f
      case 0x76:
        bytes.push(0x0b);
        i += 2;
        break; // \v
      default:
        if (n >= 0x30 && n <= 0x37) {
          // At most 3 octal digits; a byte overflow keeps the remainder, matching git.
          let value = 0;
          let j = i + 1;
          let digits = 0;
          while (j < inner.length && digits < 3) {
            const d = inner[j] as number;
            if (d < 0x30 || d > 0x37) break;
            value = (value * 8 + (d - 0x30)) & 0xff;
            j += 1;
            digits += 1;
          }
          bytes.push(value);
          i = j;
        } else {
          bytes.push(n);
          i += 2;
        }
    }
  }
  return decodeUtf8Lossy(Uint8Array.from(bytes));
}
