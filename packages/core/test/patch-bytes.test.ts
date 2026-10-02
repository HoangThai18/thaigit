// Patch dựng từ byte: kiểm tra nội dung patch (không chạy git) — kỳ vọng tính tay từ quy tắc, không lấy từ chính
// bộ dựng. Phần áp patch bằng git thật nằm ở patch-bytes-git.test.ts và patch-bytes-matrix.test.ts.

import { describe, expect, it } from 'vitest';
import {
  type FileDiff,
  type LineSelection,
  changeLineIndices,
  makePatch,
  parseDiff,
  selectionForWholeHunk,
} from '../src/diff/index.ts';
import { decodeUtf8Lossy } from '../src/support/text.ts';
import { latin1, showBytes, utf8 } from './helpers/git-cli.ts';

const lines = (...rows: string[]): string => `${rows.join('\n')}\n`;
const HEADER = lines(
  'diff --git a/f.txt b/f.txt',
  'index 1111111..2222222 100644',
  '--- a/f.txt',
  '+++ b/f.txt',
);

function fileOf(body: string | Uint8Array, header: string = HEADER): FileDiff {
  const bytes = typeof body === 'string' ? utf8(header + body) : new Uint8Array([...utf8(header), ...body]);
  const [file] = parseDiff(bytes);
  if (!file) throw new Error('không có file diff');
  return file;
}

const select = (...entries: [number, number[]][]): LineSelection =>
  new Map(entries.map(([hunk, indices]) => [hunk, new Set(indices)]));

/** Patch dưới dạng chuỗi (giữ "\r" thật) hoặc null. */
const patchText = (file: FileDiff, selection: LineSelection, reverse: boolean): string | null => {
  const patch = makePatch(file, selection, reverse);
  return patch === null ? null : decodeUtf8Lossy(patch);
};

// Hunk đầu của DiffTests.swift: ngữ cảnh, -a=1, +a=2, +b=3, ngữ cảnh, ngữ cảnh.
const SAMPLE = lines(
  '@@ -1,4 +1,5 @@ struct App',
  ' import Foundation', // 0
  '-let a = 1', //        1
  '+let a = 2', //        2
  '+let b = 3', //        3
  ' let c = 4', //        4
  ' let d = 5', //        5
);

describe('makePatch: chọn dòng trong một hunk', () => {
  const file = fileOf(SAMPLE);

  it('stage cặp xoá+thêm, dòng thêm còn lại bị bỏ', () => {
    expect(patchText(file, select([0, [1, 2]]), false)).toBe(
      HEADER +
        lines(
          '@@ -1,4 +1,4 @@',
          ' import Foundation',
          '-let a = 1',
          '+let a = 2',
          ' let c = 4',
          ' let d = 5',
        ),
    );
  });

  it('stage chỉ dòng thêm: dòng xoá chưa chọn thành ngữ cảnh (giữ nguyên dòng cũ)', () => {
    expect(patchText(file, select([0, [3]]), false)).toBe(
      HEADER +
        lines(
          '@@ -1,4 +1,5 @@',
          ' import Foundation',
          ' let a = 1',
          '+let b = 3',
          ' let c = 4',
          ' let d = 5',
        ),
    );
  });

  it('áp ngược cặp xoá+thêm: dòng thêm chưa chọn thành ngữ cảnh', () => {
    expect(patchText(file, select([0, [1, 2]]), true)).toBe(
      HEADER +
        lines(
          '@@ -1,5 +1,5 @@',
          ' import Foundation',
          '-let a = 1',
          '+let a = 2',
          ' let b = 3',
          ' let c = 4',
          ' let d = 5',
        ),
    );
  });

  it('áp ngược chỉ dòng thêm: dòng xoá chưa chọn bị bỏ', () => {
    expect(patchText(file, select([0, [3]]), true)).toBe(
      HEADER +
        lines(
          '@@ -1,4 +1,5 @@',
          ' import Foundation',
          ' let a = 2',
          '+let b = 3',
          ' let c = 4',
          ' let d = 5',
        ),
    );
  });

  it('chọn cả hunk = đúng hunk gốc (header dựng lại, bỏ phần tên hàm)', () => {
    expect(patchText(file, selectionForWholeHunk(file.hunks[0]!), false)).toBe(
      HEADER +
        lines(
          '@@ -1,4 +1,5 @@',
          ' import Foundation',
          '-let a = 1',
          '+let a = 2',
          '+let b = 3',
          ' let c = 4',
          ' let d = 5',
        ),
    );
  });

  it('selectionForWholeHunk chỉ gồm dòng thêm/xoá', () => {
    expect(selectionForWholeHunk(file.hunks[0]!)).toEqual(new Map([[0, new Set([1, 2, 3])]]));
    expect(changeLineIndices(file.hunks[0]!)).toEqual([1, 2, 3]);
  });

  it('chỉ số ngữ cảnh / ngoài phạm vi / hunk lạ không tạo thay đổi → null', () => {
    expect(makePatch(file, select(), false)).toBeNull();
    expect(makePatch(file, select([0, []]), false)).toBeNull();
    expect(makePatch(file, select([0, [0, 4, 5]]), false)).toBeNull();
    expect(makePatch(file, select([0, [99]]), false)).toBeNull();
    expect(makePatch(file, select([7, [1, 2]]), true)).toBeNull();
  });

  it('chỉ số ngữ cảnh lẫn trong lựa chọn bị bỏ qua', () => {
    expect(patchText(file, select([0, [0, 1, 2, 5]]), false)).toBe(
      patchText(file, select([0, [1, 2]]), false),
    );
  });
});

describe('makePatch: vị trí hunk khi bỏ qua/gộp nhiều hunk', () => {
  // Hunk 0 chèn 1 dòng (lệch +1 cho phía mới), hunk 1 sửa một dòng.
  const file = fileOf(
    lines('@@ -2,3 +2,4 @@', ' a', '+INS', ' b', ' c', '@@ -20,3 +21,3 @@', ' x', '-old', '+new', ' z'),
  );
  const hunk0 = '@@ -2,3 +2,4 @@\n a\n+INS\n b\n c\n';

  it('stage cả hai hunk: vị trí phía mới cộng dồn lệch của hunk trước', () => {
    expect(patchText(file, select([0, [1]], [1, [1, 2]]), false)).toBe(
      HEADER + hunk0 + lines('@@ -20,3 +21,3 @@', ' x', '-old', '+new', ' z'),
    );
  });

  it('stage riêng hunk 1: hunk 0 không áp nên không lệch', () => {
    expect(patchText(file, select([1, [1, 2]]), false)).toBe(
      HEADER + lines('@@ -20,3 +20,3 @@', ' x', '-old', '+new', ' z'),
    );
  });

  it('áp ngược riêng hunk 1: vị trí phía mới giữ nguyên, phía cũ lệch theo hunk đã áp', () => {
    expect(patchText(file, select([1, [1, 2]]), true)).toBe(
      HEADER + lines('@@ -21,3 +21,3 @@', ' x', '-old', '+new', ' z'),
    );
  });

  it('áp ngược cả hai hunk', () => {
    expect(patchText(file, select([0, [1]], [1, [1, 2]]), true)).toBe(
      HEADER + hunk0 + lines('@@ -20,3 +21,3 @@', ' x', '-old', '+new', ' z'),
    );
  });

  it('hunk không chọn dòng nào bị bỏ qua hoàn toàn', () => {
    expect(patchText(file, select([0, []], [1, [2]]), false)).toBe(
      HEADER + lines('@@ -20,3 +20,4 @@', ' x', ' old', '+new', ' z'),
    );
  });

  it('hunk không có ngữ cảnh (-U0): khoảng rỗng thì start = số dòng đứng trước', () => {
    // Chèn 2 dòng sau dòng 5, rồi xoá 2 dòng 10-11 (phía mới: sau dòng 11).
    const zero = fileOf(lines('@@ -5,0 +6,2 @@', '+a', '+b', '@@ -10,2 +11,0 @@', '-x', '-y'));
    expect(patchText(zero, select([0, [0, 1]], [1, [0, 1]]), false)).toBe(
      HEADER + lines('@@ -5,0 +6,2 @@', '+a', '+b', '@@ -10,2 +11,0 @@', '-x', '-y'),
    );
    expect(patchText(zero, select([1, [0, 1]]), false)).toBe(HEADER + lines('@@ -10,2 +9,0 @@', '-x', '-y'));
    expect(patchText(zero, select([1, [0, 1]]), true)).toBe(HEADER + lines('@@ -12,2 +11,0 @@', '-x', '-y'));
    expect(patchText(zero, select([0, [0, 1]]), true)).toBe(HEADER + lines('@@ -5,0 +6,2 @@', '+a', '+b'));
  });
});

describe('makePatch: header', () => {
  it('bỏ dòng "old mode"/"new mode" nhưng giữ các dòng header khác nguyên văn', () => {
    const file = fileOf(
      lines('@@ -1 +1 @@', '-a', '+b'),
      lines(
        'diff --git a/r.sh b/r.sh',
        'old mode 100644',
        'new mode 100755',
        'index 1..2',
        '--- a/r.sh',
        '+++ b/r.sh',
      ),
    );
    expect(patchText(file, select([0, [0, 1]]), false)).toBe(
      lines(
        'diff --git a/r.sh b/r.sh',
        'index 1..2',
        '--- a/r.sh',
        '+++ b/r.sh',
        '@@ -1,1 +1,1 @@',
        '-a',
        '+b',
      ),
    );
  });

  it('đường dẫn có dấu cách và TAB cuối dòng ---/+++ được giữ nguyên byte', () => {
    const file = fileOf(
      lines('@@ -1 +1 @@', '-a', '+b'),
      'diff --git a/ghi chú.txt b/ghi chú.txt\nindex 1..2 100644\n--- a/ghi chú.txt\t\n+++ b/ghi chú.txt\t\n',
    );
    expect(patchText(file, select([0, [0, 1]]), false)).toBe(
      'diff --git a/ghi chú.txt b/ghi chú.txt\nindex 1..2 100644\n--- a/ghi chú.txt\t\n+++ b/ghi chú.txt\t\n@@ -1,1 +1,1 @@\n-a\n+b\n',
    );
  });
});

describe('makePatch: file không hỗ trợ stage từng phần → null', () => {
  const everything = select([0, [0, 1, 2]]);
  it('nhị phân', () => {
    const [file] = parseDiff(
      utf8(
        lines('diff --git a/a.png b/a.png', 'index 1..2 100644', 'Binary files a/a.png and b/a.png differ'),
      ),
    );
    expect(makePatch(file!, everything, false)).toBeNull();
  });
  it('file mới, file bị xoá', () => {
    const created = fileOf(
      lines('@@ -0,0 +1,2 @@', '+a', '+b'),
      lines(
        'diff --git a/n.txt b/n.txt',
        'new file mode 100644',
        'index 0..1',
        '--- /dev/null',
        '+++ b/n.txt',
      ),
    );
    const removed = fileOf(
      lines('@@ -1,2 +0,0 @@', '-a', '-b'),
      lines(
        'diff --git a/n.txt b/n.txt',
        'deleted file mode 100644',
        'index 1..0',
        '--- a/n.txt',
        '+++ /dev/null',
      ),
    );
    expect(makePatch(created, everything, false)).toBeNull();
    expect(makePatch(removed, everything, true)).toBeNull();
  });
  it('chỉ đổi tên / chỉ đổi quyền (không có hunk, không có ---/+++)', () => {
    const [renamed, mode] = parseDiff(
      utf8(
        lines(
          'diff --git a/a.txt b/b.txt',
          'similarity index 100%',
          'rename from a.txt',
          'rename to b.txt',
          'diff --git a/r.sh b/r.sh',
          'old mode 100644',
          'new mode 100755',
        ),
      ),
    );
    expect(makePatch(renamed!, everything, false)).toBeNull();
    expect(makePatch(mode!, everything, false)).toBeNull();
  });
});

describe('makePatch: byte nguyên vẹn (CRLF, không phải UTF-8)', () => {
  it('giữ "\\r" của từng dòng CRLF: patch có đúng "\\r\\n" như diff', () => {
    const file = fileOf('@@ -1,3 +1,3 @@\n a\r\n-b\r\n+c\r\n d\r\n');
    const patch = makePatch(file, select([0, [1, 2]]), false)!;
    expect(showBytes(patch)).toBe(showBytes(utf8(`${HEADER}@@ -1,3 +1,3 @@\n a\r\n-b\r\n+c\r\n d\r\n`)));
    expect(decodeUtf8Lossy(patch).includes('\r\n')).toBe(true);
  });

  it('dòng chưa chọn đổi vai (xoá → ngữ cảnh) vẫn giữ "\\r"', () => {
    const file = fileOf('@@ -1,2 +1,2 @@\n-a\r\n+b\r\n c\r\n');
    expect(decodeUtf8Lossy(makePatch(file, select([0, [1]]), false)!)).toBe(
      `${HEADER}@@ -1,2 +1,3 @@\n a\r\n+b\r\n c\r\n`,
    );
  });

  it('file lẫn LF/CRLF: từng dòng giữ ký tự xuống dòng của riêng nó', () => {
    const file = fileOf('@@ -1,3 +1,3 @@\n a\n-b\r\n+c\n d\r\n');
    expect(decodeUtf8Lossy(makePatch(file, select([0, [1, 2]]), true)!)).toBe(
      `${HEADER}@@ -1,3 +1,3 @@\n a\n-b\r\n+c\n d\r\n`,
    );
  });

  it('byte CP1252/CP1258 đi qua nguyên vẹn (không giải mã/mã hoá lại)', () => {
    const body = latin1('@@ -1,3 +1,3 @@\n caf\xe9\n-Vi\xea\xf2t\n+Vi\xea\xf2t Nam\xd0\n \xe0\xe1\xe2\n');
    const file = fileOf(body);
    const patch = makePatch(file, select([0, [1, 2]]), false)!;
    expect([...patch.slice(-(body.length - 14))]).toEqual([...body.slice(14)]);
    // Đối chứng: đi qua giải mã lỏng + mã hoá lại sẽ làm hỏng byte 0xE9.
    expect([...new TextEncoder().encode(new TextDecoder().decode(patch))]).not.toEqual([...patch]);
  });

  it('BOM ở đầu dòng đầu tiên của file được giữ', () => {
    const body = new Uint8Array([
      ...utf8('@@ -1 +1 @@\n-'),
      0xef,
      0xbb,
      0xbf,
      ...utf8('a\r\n+'),
      0xef,
      0xbb,
      0xbf,
      ...utf8('b\r\n'),
    ]);
    const patch = makePatch(fileOf(body), select([0, [0, 1]]), false)!;
    expect([...patch.slice(-14)]).toEqual([
      0x2d, 0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a, 0x2b, 0xef, 0xbb, 0xbf, 0x62, 0x0d, 0x0a,
    ]);
  });
});

describe('makePatch: "\\ No newline at end of file"', () => {
  it('cả hai phía thiếu newline, đổi dòng cuối: giữ nguyên cặp -/+', () => {
    const file = fileOf(
      lines(
        '@@ -1,2 +1,2 @@',
        ' a',
        '-b',
        '\\ No newline at end of file',
        '+B',
        '\\ No newline at end of file',
      ),
    );
    expect(patchText(file, select([0, [1, 3]]), false)).toBe(
      HEADER +
        lines(
          '@@ -1,2 +1,2 @@',
          ' a',
          '-b',
          '\\ No newline at end of file',
          '+B',
          '\\ No newline at end of file',
        ),
    );
  });

  it('dòng ngữ cảnh cuối thiếu newline là dòng cuối của cả hai phía: giữ nguyên', () => {
    const file = fileOf(lines('@@ -1,3 +1,3 @@', ' a', '-b', '+B', ' c', '\\ No newline at end of file'));
    expect(patchText(file, select([0, [1, 2]]), false)).toBe(
      HEADER + lines('@@ -1,3 +1,3 @@', ' a', '-b', '+B', ' c', '\\ No newline at end of file'),
    );
  });

  // "a\nb\nc" (không newline cuối) → "a\nB\nc\nd" (không newline cuối).
  const grow = fileOf(
    lines(
      '@@ -1,3 +1,4 @@',
      ' a', //                         0
      '-b', //                         1
      '+B', //                         2
      '-c', //                         3
      '\\ No newline at end of file', // 4
      '+c', //                         5
      '+d', //                         6
      '\\ No newline at end of file', // 7
    ),
  );

  it('stage riêng b→B: "-c" chưa chọn thành ngữ cảnh, vẫn là dòng cuối của cả hai phía', () => {
    expect(patchText(grow, select([0, [1, 2]]), false)).toBe(
      HEADER + lines('@@ -1,3 +1,3 @@', ' a', '-b', '+B', ' c', '\\ No newline at end of file'),
    );
  });

  it('stage b→B và thêm d: dòng "c" không còn là dòng cuối phía mới → tách thành -c(không newline) / +c', () => {
    expect(patchText(grow, select([0, [1, 2, 6]]), false)).toBe(
      HEADER +
        lines(
          '@@ -1,3 +1,4 @@',
          ' a',
          '-b',
          '+B',
          '-c',
          '\\ No newline at end of file',
          '+c',
          '+d',
          '\\ No newline at end of file',
        ),
    );
  });

  it('áp ngược: dòng ngữ cảnh thiếu newline là cuối phía mới nhưng không phải cuối phía cũ → -c / +c(không newline)', () => {
    // Diff: "x1\nx2\n" → "y1" (không newline cuối). Áp ngược chỉ hai dòng xoá.
    const file = fileOf(lines('@@ -1,2 +1 @@', '-x1', '-x2', '+y1', '\\ No newline at end of file'));
    expect(patchText(file, select([0, [0, 1]]), true)).toBe(
      HEADER + lines('@@ -1,3 +1,1 @@', '-x1', '-y1', '+y1', '\\ No newline at end of file', '-x2'),
    );
  });

  it('ngữ cảnh thiếu newline nằm giữa (không phải cuối phía nào) → bỏ dấu "\\ No newline"', () => {
    const file = fileOf(lines('@@ -1,2 +1,2 @@', ' c', '\\ No newline at end of file', '-y', '+x'));
    expect(patchText(file, select([0, [2, 3]]), false)).toBe(
      HEADER + lines('@@ -1,2 +1,2 @@', ' c', '-y', '+x'),
    );
  });

  // Hỏng dữ liệu âm thầm ở bản Swift: git áp patch thành công nhưng nối hai dòng ("y1" + "x2" → "y1x2").
  it('stage riêng dòng thêm cuối-file-không-newline: dời xuống cuối khối, không đứng trước dòng ngữ cảnh', () => {
    const file = fileOf(lines('@@ -1,2 +1 @@', '-x1', '-x2', '+y1', '\\ No newline at end of file'));
    expect(patchText(file, select([0, [2]]), false)).toBe(
      HEADER + lines('@@ -1,2 +1,3 @@', ' x1', ' x2', '+y1', '\\ No newline at end of file'),
    );
  });

  it('áp ngược riêng dòng xoá cuối-file-không-newline: dời xuống cuối khối', () => {
    const file = fileOf(lines('@@ -1 +1,2 @@', '-x1', '\\ No newline at end of file', '+y1', '+y2'));
    expect(patchText(file, select([0, [0]]), true)).toBe(
      HEADER + lines('@@ -1,3 +1,2 @@', ' y1', ' y2', '-x1', '\\ No newline at end of file'),
    );
  });

  it('dòng không newline đã chọn đã ở cuối phía của nó thì không bị dời', () => {
    const file = fileOf(
      lines(
        '@@ -1,2 +1,2 @@',
        '-x1',
        '-x2',
        '\\ No newline at end of file',
        '+y1',
        '+y2',
        '\\ No newline at end of file',
      ),
    );
    expect(patchText(file, select([0, [0, 1, 3, 4]]), false)).toBe(
      HEADER +
        lines(
          '@@ -1,2 +1,2 @@',
          '-x1',
          '+y1',
          '-x2',
          '\\ No newline at end of file',
          '+y2',
          '\\ No newline at end of file',
        ),
    );
  });
});

describe('makePatch: dòng vừa được thêm xuống dòng theo kiểu của file (CRLF)', () => {
  it('file CRLF: dòng cuối "c" không còn là dòng cuối phía mới → -c(không newline) / +c\\r, không để lọt "\\n" lẻ', () => {
    // "a\r\nb\r\nc" → "a\r\nB\r\nc\r\nd" (cả hai không newline cuối).
    const file = fileOf(
      '@@ -1,3 +1,4 @@\n a\r\n-b\r\n+B\r\n-c\n\\ No newline at end of file\n+c\r\n+d\n\\ No newline at end of file\n',
    );
    expect(decodeUtf8Lossy(makePatch(file, select([0, [1, 2, 6]]), false)!)).toBe(
      `${HEADER}@@ -1,3 +1,4 @@\n a\r\n-b\r\n+B\r\n-c\n\\ No newline at end of file\n+c\r\n+d\n\\ No newline at end of file\n`,
    );
  });

  it('áp ngược trên file CRLF: phía được thêm xuống dòng dùng "\\r\\n"', () => {
    const file = fileOf('@@ -1,2 +1 @@\n-x1\r\n-x2\r\n+y1\n\\ No newline at end of file\n');
    expect(decodeUtf8Lossy(makePatch(file, select([0, [0, 1]]), true)!)).toBe(
      `${HEADER}@@ -1,3 +1,1 @@\n-x1\r\n-y1\r\n+y1\n\\ No newline at end of file\n-x2\r\n`,
    );
  });

  it('file LF vẫn thêm "\\n" đơn; không có dòng lân cận nào thì mặc định LF', () => {
    const lf = fileOf('@@ -1,2 +1 @@\n-x1\n-x2\n+y1\n\\ No newline at end of file\n');
    expect(decodeUtf8Lossy(makePatch(lf, select([0, [0, 1]]), true)!)).toBe(
      `${HEADER}@@ -1,3 +1,1 @@\n-x1\n-y1\n+y1\n\\ No newline at end of file\n-x2\n`,
    );
    const alone = fileOf(
      '@@ -1 +1,2 @@\n-x\n\\ No newline at end of file\n+x\n+y\n\\ No newline at end of file\n',
    );
    // Chỉ chọn "+y": "-x(không newline)" chưa chọn → ngữ cảnh cuối cũ, cần thêm newline; không có dòng lân cận
    // nào có xuống dòng để học kiểu → mặc định LF.
    expect(decodeUtf8Lossy(makePatch(alone, select([0, [3]]), false)!)).toBe(
      `${HEADER}@@ -1,1 +1,2 @@\n-x\n\\ No newline at end of file\n+x\n+y\n\\ No newline at end of file\n`,
    );
  });
});

describe('makePatch: file đổi tên (diff --cached -M) — không bao giờ đổi tên ngược trong index', () => {
  const body = lines('@@ -1,3 +1,3 @@', ' l1', '-l2', '+L2', ' l3');
  const renameHeader = lines(
    'diff --git a/a.txt b/b.txt',
    'similarity index 80%',
    'rename from a.txt',
    'rename to b.txt',
    'index 01f84f8..e864914 100644',
    '--- a/a.txt',
    '+++ b/b.txt',
  );
  const patchBody = lines('@@ -1,3 +1,3 @@', ' l1', '-l2', '+L2', ' l3');

  it('áp ngược (unstage): header thành sửa nội dung đường dẫn MỚI, bỏ rename/similarity', () => {
    expect(patchText(fileOf(body, renameHeader), select([0, [1, 2]]), true)).toBe(
      lines('diff --git a/b.txt b/b.txt', 'index 01f84f8..e864914 100644', '--- a/b.txt', '+++ b/b.txt') +
        patchBody,
    );
  });

  it('áp xuôi: đường dẫn CŨ', () => {
    expect(patchText(fileOf(body, renameHeader), select([0, [1, 2]]), false)).toBe(
      lines('diff --git a/a.txt b/a.txt', 'index 01f84f8..e864914 100644', '--- a/a.txt', '+++ b/a.txt') +
        patchBody,
    );
  });

  it('tên trong ngoặc kép (escape bát phân) giữ nguyên dạng', () => {
    const header = lines(
      'diff --git "a/t\\303\\240i.txt" "b/m\\341\\273\\233i.txt"',
      'similarity index 90%',
      'rename from "t\\303\\240i.txt"',
      'rename to "m\\341\\273\\233i.txt"',
      'index 1..2 100644',
      '--- "a/t\\303\\240i.txt"',
      '+++ "b/m\\341\\273\\233i.txt"',
    );
    expect(patchText(fileOf(body, header), select([0, [1, 2]]), true)).toBe(
      lines(
        'diff --git "a/m\\341\\273\\233i.txt" "b/m\\341\\273\\233i.txt"',
        'index 1..2 100644',
        '--- "a/m\\341\\273\\233i.txt"',
        '+++ "b/m\\341\\273\\233i.txt"',
      ) + patchBody,
    );
  });

  it('tên có dấu cách + TAB cuối dòng ---/+++', () => {
    const header =
      'diff --git a/old name.txt b/new name.txt\nsimilarity index 90%\nrename from old name.txt\nrename to new name.txt\nindex 1..2 100644\n--- a/old name.txt\t\n+++ b/new name.txt\t\n';
    expect(patchText(fileOf(body, header), select([0, [1, 2]]), true)).toBe(
      'diff --git a/new name.txt b/new name.txt\nindex 1..2 100644\n--- a/new name.txt\t\n+++ b/new name.txt\t\n' +
        patchBody,
    );
  });

  it('sao chép (copy from/to) xử lý như đổi tên', () => {
    const header = lines(
      'diff --git a/a.txt b/c.txt',
      'similarity index 80%',
      'copy from a.txt',
      'copy to c.txt',
      'index 1..2 100644',
      '--- a/a.txt',
      '+++ b/c.txt',
    );
    expect(patchText(fileOf(body, header), select([0, [1, 2]]), true)).toBe(
      lines('diff --git a/c.txt b/c.txt', 'index 1..2 100644', '--- a/c.txt', '+++ b/c.txt') + patchBody,
    );
  });

  it('tiền tố tên lạ (không phải a/ b/) trên file đổi tên → từ chối (null) thay vì đoán', () => {
    const header = lines(
      'diff --git x/a.txt y/b.txt',
      'similarity index 80%',
      'rename from a.txt',
      'rename to b.txt',
      '--- x/a.txt',
      '+++ y/b.txt',
    );
    expect(makePatch(fileOf(body, header), select([0, [1, 2]]), true)).toBeNull();
  });

  it('file không đổi tên dùng tiền tố tuỳ ý vẫn giữ header nguyên văn', () => {
    const header = lines('diff --git x/a.txt y/a.txt', '--- x/a.txt', '+++ y/a.txt');
    expect(patchText(fileOf(body, header), select([0, [1, 2]]), false)).toBe(header + patchBody);
  });
});
