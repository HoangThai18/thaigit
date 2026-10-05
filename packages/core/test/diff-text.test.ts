import { describe, expect, it } from 'vitest';
import {
  codePointLength,
  countLineEndings,
  decodeUtf8Lossy,
  decodeUtf8Strict,
  detectLineEnding,
  encodeUtf8,
  hasUtf8Bom,
  isGraphemeBoundary,
  isValidUtf8,
  truncateCodePoints,
} from '../src/support/text.ts';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

describe('giải mã UTF-8 chặt / lỏng', () => {
  it('chặt: UTF-8 hợp lệ (tiếng Việt, emoji, rỗng) giải được, BOM giữ thành U+FEFF', () => {
    expect(decodeUtf8Strict(encodeUtf8('Việt Nam 🇻🇳'))).toBe('Việt Nam 🇻🇳');
    expect(decodeUtf8Strict(new Uint8Array())).toBe('');
    expect(decodeUtf8Strict(bytes(0xef, 0xbb, 0xbf, 0x61))).toBe('﻿a');
  });

  it('chặt: CP1252/CP1258, UTF-16, đa byte cụt, overlong, surrogate → null', () => {
    for (const bad of [
      bytes(0x63, 0x61, 0x66, 0xe9),
      bytes(0x56, 0x69, 0xea, 0xf2, 0x74),
      bytes(0xff, 0xfe, 0x61, 0x00),
      bytes(0x61, 0xe1, 0xbb),
      bytes(0xc0, 0x80),
      bytes(0xed, 0xa0, 0x80),
      bytes(0xf4, 0x90, 0x80, 0x80), // > U+10FFFF
    ]) {
      expect(decodeUtf8Strict(bad), [...bad].join(',')).toBeNull();
      expect(isValidUtf8(bad)).toBe(false);
    }
    expect(isValidUtf8(encodeUtf8('ok'))).toBe(true);
  });

  it('lỏng: byte sai thành U+FFFD, không bao giờ ném lỗi, BOM giữ lại', () => {
    expect(decodeUtf8Lossy(bytes(0x63, 0xe9, 0x21))).toBe('c�!');
    expect(decodeUtf8Lossy(bytes(0xef, 0xbb, 0xbf, 0x61))).toBe('﻿a');
    expect(decodeUtf8Lossy(bytes(0xff, 0xff))).toBe('��');
  });

  it('hasUtf8Bom', () => {
    expect(hasUtf8Bom(bytes(0xef, 0xbb, 0xbf))).toBe(true);
    expect(hasUtf8Bom(bytes(0xef, 0xbb, 0xbf, 0x61))).toBe(true);
    expect(hasUtf8Bom(bytes(0xef, 0xbb))).toBe(false);
    expect(hasUtf8Bom(bytes(0xfe, 0xff))).toBe(false);
    expect(hasUtf8Bom(new Uint8Array())).toBe(false);
  });
});

describe('kiểu xuống dòng', () => {
  const enc = (text: string) => encodeUtf8(text);

  it('đếm "\\r\\n" và "\\n" đơn; "\\r" đứng một mình không phải xuống dòng', () => {
    expect(countLineEndings(enc('a\r\nb\nc\r\nd'))).toEqual({ crlf: 2, lf: 1 });
    expect(countLineEndings(enc('a\rb\rc'))).toEqual({ crlf: 0, lf: 0 });
    expect(countLineEndings(enc('\n\n'))).toEqual({ crlf: 0, lf: 2 });
    expect(countLineEndings(enc('\r\n'))).toEqual({ crlf: 1, lf: 0 });
  });

  it('phân loại none / lf / crlf / mixed', () => {
    expect(detectLineEnding(enc(''))).toBe('none');
    expect(detectLineEnding(enc('không có xuống dòng'))).toBe('none');
    expect(detectLineEnding(enc('a\nb\n'))).toBe('lf');
    expect(detectLineEnding(enc('a\r\nb\r\n'))).toBe('crlf');
    expect(detectLineEnding(enc('a\r\nb\n'))).toBe('mixed');
  });
});

describe('ký tự hiển thị', () => {
  it('codePointLength: cặp thay thế là một, dấu kết hợp vẫn tính riêng', () => {
    expect(codePointLength('')).toBe(0);
    expect(codePointLength('abc')).toBe(3);
    expect(codePointLength('a😀b')).toBe(3);
    expect(codePointLength('é')).toBe(2);
    expect(codePointLength('\ud83d')).toBe(1); // a lone high surrogate
  });

  it('isGraphemeBoundary: ASCII, đầu/cuối chuỗi, "\\r\\n", cặp thay thế, dấu kết hợp, emoji ghép, cờ', () => {
    expect(isGraphemeBoundary('abc', 0)).toBe(true);
    expect(isGraphemeBoundary('abc', 1)).toBe(true);
    expect(isGraphemeBoundary('abc', 3)).toBe(true);
    expect(isGraphemeBoundary('a\r\nb', 2)).toBe(false);
    expect(isGraphemeBoundary('a\r\nb', 1)).toBe(true);
    expect(isGraphemeBoundary('a😀b', 2)).toBe(false);
    expect(isGraphemeBoundary('a😀b', 3)).toBe(true);
    expect(isGraphemeBoundary('éx', 1)).toBe(false);
    expect(isGraphemeBoundary('éx', 2)).toBe(true);
    const family = '👨‍👩‍👧';
    expect(isGraphemeBoundary(`${family}x`, 2)).toBe(false);
    expect(isGraphemeBoundary(`${family}x`, family.length)).toBe(true);
    const flags = '🇻🇳🇺🇸';
    expect(isGraphemeBoundary(flags, 2)).toBe(false);
    expect(isGraphemeBoundary(flags, 4)).toBe(true);
  });

  it('truncateCodePoints: giữ nguyên khi đủ ngắn, cắt theo code point, lùi về ranh giới grapheme', () => {
    expect(truncateCodePoints('abc', 3)).toBe('abc');
    expect(truncateCodePoints('abcdef', 3)).toBe('abc');
    expect(truncateCodePoints('a😀b', 2)).toBe('a😀');
    expect(truncateCodePoints('ab😀😀', 3)).toBe('ab😀');
    // Cutting between "e" and a combining mark backs up to before the "e".
    expect(truncateCodePoints('abécd', 3)).toBe('ab');
    expect(truncateCodePoints('', 5)).toBe('');
  });
});
