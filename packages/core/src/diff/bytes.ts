// Pure Uint8Array helpers for diff/patch/conflict. Lines split on the byte "\n" (0x0A) only; "\r" always stays
// inside the line — deliberately different from the Swift version, where Character treats "\r\n" as one character.

export const LF = 0x0a;
export const CR = 0x0d;

/** Bytes of an ASCII string (for prefixes and fixed lines). */
export function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0x7f;
  return out;
}

/** Do `bytes` (from offset `at`) start with the ASCII string `prefix`? */
export function startsWithAscii(bytes: Uint8Array, prefix: string, at = 0): boolean {
  if (at + prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[at + i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export interface LineSpan {
  /** Byte offset of the line start. */
  readonly start: number;
  /** End of the content (before "\n" or "\r\n"). */
  readonly contentEnd: number;
  /** End of line including its terminator; equal to `contentEnd` when the last line has none. */
  readonly end: number;
}

/**
 * Split into lines on "\n"; a "\r" immediately before the "\n" is part of the terminator (`contentEnd` stops before
 * it), any other "\r" stays in the content. A trailing chunk without "\n" is its own line (if non-empty).
 */
export function splitLineSpans(bytes: Uint8Array, from = 0): LineSpan[] {
  const spans: LineSpan[] = [];
  let start = from;
  while (start < bytes.length) {
    const lf = bytes.indexOf(LF, start);
    if (lf === -1) {
      spans.push({ start, contentEnd: bytes.length, end: bytes.length });
      break;
    }
    const contentEnd = lf > start && bytes[lf - 1] === CR ? lf - 1 : lf;
    spans.push({ start, contentEnd, end: lf + 1 });
    start = lf + 1;
  }
  return spans;
}
