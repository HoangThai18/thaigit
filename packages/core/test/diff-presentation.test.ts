import { describe, expect, it } from 'vitest';
import {
  MAX_DISPLAY_LENGTH,
  buildPresentation,
  buildSplitRows,
  changedRanges,
  displayText,
  inlineHighlights,
  parseDiff,
} from '../src/diff/index.ts';
import { latin1, utf8 } from './helpers/git-cli.ts';

const FILE_HEADER = 'diff --git a/f.txt b/f.txt\nindex 1..2 100644\n--- a/f.txt\n+++ b/f.txt\n';

function presentationOf(body: string | Uint8Array) {
  const bytes =
    typeof body === 'string' ? utf8(FILE_HEADER + body) : new Uint8Array([...utf8(FILE_HEADER), ...body]);
  const [file] = parseDiff(bytes);
  return buildPresentation(file!);
}

describe('InlineDiff.changedRanges (port inlineHighlightFindsChangedMiddle)', () => {
  it('tìm phần giữa khác nhau', () => {
    const ranges = changedRanges('let value = computeTotal(a, b)', 'let value = computeSum(a, b)');
    expect(ranges?.old).toEqual({ start: 19, end: 24 });
    expect(ranges?.new).toEqual({ start: 19, end: 22 });
  });

  it('khác nhau quá nhiều, giống hệt, hoặc quá dài → null', () => {
    expect(changedRanges('abc', 'xyz')).toBeNull();
    expect(changedRanges('abc', 'abc')).toBeNull();
    expect(changedRanges('', '')).toBeNull();
    expect(changedRanges('', 'abc')).toBeNull();
    const long = 'x'.repeat(2000);
    expect(changedRanges(long, `${long}y`)).toBeNull();
    expect(changedRanges('x'.repeat(1999), 'x'.repeat(1998))).not.toBeNull();
  });

  it('chỉ thêm hoặc chỉ xoá ở cuối: khoảng rỗng ở một phía', () => {
    expect(changedRanges('abc', 'abcd')).toEqual({ old: { start: 3, end: 3 }, new: { start: 3, end: 4 } });
    expect(changedRanges('abcd', 'abc')).toEqual({ old: { start: 3, end: 4 }, new: { start: 3, end: 3 } });
  });

  it('không xé cặp thay thế: hai emoji chung nửa đầu', () => {
    const ranges = changedRanges('a😀b', 'a😁b')!;
    expect(ranges.old).toEqual({ start: 1, end: 3 });
    expect('a😀b'.slice(ranges.old.start, ranges.old.end)).toBe('😀');
    expect('a😁b'.slice(ranges.new.start, ranges.new.end)).toBe('😁');
  });

  it('không xé chữ + dấu kết hợp (tiếng Việt dạng NFD)', () => {
    // "ệ" = e + dot below + circumflex; "ể" = e + hook above + circumflex: same base letter, different marks.
    const oldText = 'Việt';
    const newText = 'Viẻ̂t';
    const ranges = changedRanges(oldText, newText)!;
    expect(oldText.slice(ranges.old.start, ranges.old.end)).toBe('ệ');
    expect(newText.slice(ranges.new.start, ranges.new.end)).toBe('ẻ̂');
  });

  it('dạng NFC: vị trí tính theo UTF-16 dùng thẳng với String.slice', () => {
    const ranges = changedRanges('chào bạn', 'chào bác')!;
    expect('chào bạn'.slice(ranges.old.start, ranges.old.end)).toBe('ạn');
    expect('chào bác'.slice(ranges.new.start, ranges.new.end)).toBe('ác');
  });
});

describe('inlineHighlights', () => {
  it('ghép dòng xoá thứ k với dòng thêm thứ k, bỏ qua dòng "\\ No newline" xen giữa', () => {
    const highlights = inlineHighlights([
      { kind: 'context', text: 'x' },
      { kind: 'deletion', text: 'let a = 1' },
      { kind: 'deletion', text: 'let b = 1' },
      { kind: 'noNewline', text: '' },
      { kind: 'addition', text: 'let a = 2' },
      { kind: 'addition', text: 'let b = 2' },
      { kind: 'addition', text: 'thêm hẳn dòng mới' },
    ]);
    expect([...highlights.keys()].sort()).toEqual([1, 2, 4, 5]);
    expect(highlights.get(1)).toEqual({ start: 8, end: 9 });
    expect(highlights.get(4)).toEqual({ start: 8, end: 9 });
  });

  it('dòng thêm không đi liền sau dòng xoá thì không ghép', () => {
    expect(
      inlineHighlights([
        { kind: 'addition', text: 'a' },
        { kind: 'context', text: 'b' },
      ]).size,
    ).toBe(0);
  });
});

describe('displayText', () => {
  it('tab → 4 dấu cách (thay thẳng, không theo tab stop), bỏ một "\\r" cuối', () => {
    expect(displayText('\tfoo\tbar')).toBe('    foo    bar');
    expect(displayText('foo\r')).toBe('foo');
    expect(displayText('foo\r\r')).toBe('foo\r');
    expect(displayText('a\rb')).toBe('a\rb');
  });

  it('cắt dòng quá dài còn 1.200 ký tự + " …"', () => {
    const exact = 'x'.repeat(MAX_DISPLAY_LENGTH);
    expect(displayText(exact)).toBe(exact);
    const cut = displayText(`${exact}yyy`);
    expect(cut).toBe(`${exact} …`);
    expect(MAX_DISPLAY_LENGTH).toBe(1200);
  });

  it('cắt theo code point, không xé cặp thay thế ở ranh giới', () => {
    const cut = displayText(`${'x'.repeat(MAX_DISPLAY_LENGTH - 1)}😀😀`);
    expect(cut).toBe(`${'x'.repeat(MAX_DISPLAY_LENGTH - 1)}😀 …`);
  });
});

describe('buildPresentation', () => {
  it('đổi tab và bỏ "\\r" rồi tính tô đậm trên chữ đã đổi (khớp vị trí hiển thị)', () => {
    const presentation = presentationOf('@@ -1 +1 @@\n-\tfoo(1)\r\n+\tfoo(2)\r\n');
    const [deletion, addition] = presentation.hunks[0]!.lines;
    expect(deletion!.text).toBe('    foo(1)');
    expect(addition!.text).toBe('    foo(2)');
    expect(deletion!.highlight).toEqual({ start: 8, end: 9 });
    expect(addition!.highlight).toEqual({ start: 8, end: 9 });
  });

  it('maxLineLength / maxLineNumber / chỉ số dòng / số dòng cũ-mới', () => {
    const presentation = presentationOf('@@ -98,3 +98,4 @@ ngữ cảnh\n a\n-bbbb\n+cc\n+dddddd\n e\n');
    expect(presentation.maxLineNumber).toBe(101);
    expect(presentation.maxLineLength).toBe(6);
    const hunk = presentation.hunks[0]!;
    expect(hunk.header).toBe('@@ -98,3 +98,4 @@ ngữ cảnh');
    expect(hunk.lines.map((line) => line.index)).toEqual([0, 1, 2, 3, 4]);
    expect(hunk.lines.map((line) => [line.oldNumber, line.newNumber])).toEqual([
      [98, 98],
      [99, null],
      [null, 99],
      [null, 100],
      [100, 101],
    ]);
  });

  it('maxLineLength đếm cả " …" của dòng bị cắt (1.202)', () => {
    const presentation = presentationOf(`@@ -1 +1 @@\n-${'a'.repeat(1300)}\n+b\n`);
    expect(presentation.maxLineLength).toBe(1202);
  });

  it('dòng "\\ No newline" được giữ trong lines nhưng không có số dòng và không vào hàng hai cột', () => {
    const presentation = presentationOf(
      '@@ -1,2 +1,2 @@\n x\n-y\n\\ No newline at end of file\n+z\n\\ No newline at end of file\n',
    );
    const hunk = presentation.hunks[0]!;
    expect(hunk.lines.map((line) => line.kind)).toEqual([
      'context',
      'deletion',
      'noNewline',
      'addition',
      'noNewline',
    ]);
    expect(hunk.lines[2]!.text).toBe('No newline at end of file');
    expect(hunk.splitRows.map((row) => [row.left?.text ?? null, row.right?.text ?? null])).toEqual([
      ['x', 'x'],
      ['y', 'z'],
    ]);
  });

  it('hai cột: ghép xoá thứ k với thêm thứ k, bên thiếu là null', () => {
    const presentation = presentationOf('@@ -1,5 +1,5 @@\n a\n-b1\n-b2\n-b3\n+c1\n d\n+e1\n+e2\n');
    const rows = presentation.hunks[0]!.splitRows.map((row) => [
      row.left?.text ?? null,
      row.right?.text ?? null,
    ]);
    expect(rows).toEqual([
      ['a', 'a'],
      ['b1', 'c1'],
      ['b2', null],
      ['b3', null],
      ['d', 'd'],
      [null, 'e1'],
      [null, 'e2'],
    ]);
    // Both sides of a context line are the very same line object.
    const first = presentation.hunks[0]!.splitRows[0]!;
    expect(first.left).toBe(first.right);
  });

  it('byte không phải UTF-8 chỉ ảnh hưởng chữ hiển thị (U+FFFD), byte trong diff gốc vẫn nguyên', () => {
    const presentation = presentationOf(latin1('@@ -1 +1 @@\n-caf\xe9\n+caf\xe8\n'));
    const [deletion, addition] = presentation.hunks[0]!.lines;
    expect(deletion!.text).toBe('caf�');
    expect(addition!.text).toBe('caf�');
    expect(presentation.diff.hunks[0]!.lines[0]!.text[3]).toBe(0xe9);
    expect(presentation.diff.hunks[0]!.lines[1]!.text[3]).toBe(0xe8);
  });

  it('BOM đầu file giữ lại thành U+FEFF để thấy được thay đổi BOM bằng tô đậm', () => {
    const presentation = presentationOf(
      new Uint8Array([...utf8('@@ -1 +1 @@\n-foo\n+'), 0xef, 0xbb, 0xbf, ...utf8('foo\n')]),
    );
    const [deletion, addition] = presentation.hunks[0]!.lines;
    expect(deletion!.text).toBe('foo');
    expect(addition!.text).toBe('﻿foo');
    expect(addition!.highlight).toEqual({ start: 0, end: 1 });
  });

  it('buildSplitRows: bỏ qua noNewline đứng riêng', () => {
    const rows = buildSplitRows([
      { index: 0, kind: 'noNewline', text: '', oldNumber: null, newNumber: null, highlight: null },
    ]);
    expect(rows).toEqual([]);
  });

  it('diff không có hunk (nhị phân/đổi tên): hunks rỗng, số đo bằng 0', () => {
    const [file] = parseDiff(utf8('diff --git a/a.png b/a.png\nBinary files a/a.png and b/a.png differ\n'));
    const presentation = buildPresentation(file!);
    expect(presentation.hunks).toEqual([]);
    expect([presentation.maxLineLength, presentation.maxLineNumber]).toEqual([0, 0]);
  });
});
