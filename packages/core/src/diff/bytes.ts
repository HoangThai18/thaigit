// Tiện ích thuần trên Uint8Array cho diff/patch/conflict. Tách dòng chỉ theo byte "\n" (0x0A);
// "\r" luôn nằm lại trong dòng — đây là chỗ khác bản Swift (Character coi "\r\n" là một ký tự nên không tách được).

export const LF = 0x0a;
export const CR = 0x0d;

/** Byte của một chuỗi ASCII (dùng cho tiền tố và dòng cố định). */
export function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0x7f;
  return out;
}

/** `bytes` (từ vị trí `at`) có bắt đầu bằng chuỗi ASCII `prefix` không. */
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
  /** Vị trí byte đầu dòng. */
  readonly start: number;
  /** Hết phần nội dung (trước "\n" hoặc "\r\n"). */
  readonly contentEnd: number;
  /** Hết dòng, gồm cả ký tự xuống dòng; bằng `contentEnd` nếu dòng cuối không có xuống dòng. */
  readonly end: number;
}

/**
 * Tách thành các dòng theo "\n"; "\r" đứng ngay trước "\n" thuộc ký tự xuống dòng (`contentEnd` nằm trước nó),
 * mọi "\r" khác nằm lại trong nội dung. Phần cuối không có "\n" là một dòng riêng (nếu không rỗng).
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
