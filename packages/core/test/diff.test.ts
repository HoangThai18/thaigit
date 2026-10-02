import { describe, expect, it } from 'vitest';
import {
  changeLineIndices,
  diffLineCount,
  hunkHighlights,
  isChangeLine,
  isModeChangeOnly,
  parseDiff,
  parseHunkHeader,
  supportsPartialStaging,
} from '../src/diff/index.ts';
import { decodeUtf8Lossy, unquoteGitPath } from '../src/support/text.ts';
import { latin1, showBytes, utf8 } from './helpers/git-cli.ts';

const lines = (...rows: string[]): string => `${rows.join('\n')}\n`;

// Mẫu y hệt DiffTests.swift
const sample = lines(
  'diff --git a/src/app.swift b/src/app.swift',
  'index 1111111..2222222 100644',
  '--- a/src/app.swift',
  '+++ b/src/app.swift',
  '@@ -1,4 +1,5 @@ struct App',
  ' import Foundation',
  '-let a = 1',
  '+let a = 2',
  '+let b = 3',
  ' let c = 4',
  ' let d = 5',
  '@@ -10,2 +11,2 @@',
  ' x',
  '-y',
  '\\ No newline at end of file',
  '+z',
  '\\ No newline at end of file',
  'diff --git a/img.png b/img.png',
  'index 3333333..4444444 100644',
  'Binary files a/img.png and b/img.png differ',
);

const kinds = (hunkLines: readonly { kind: string }[]): string[] => hunkLines.map((line) => line.kind);
const text = (bytes: Uint8Array): string => decodeUtf8Lossy(bytes);

describe('parseDiff (port DiffTests.swift)', () => {
  it('parsesHunksAndLineNumbers', () => {
    const files = parseDiff(utf8(sample));
    expect(files).toHaveLength(2);
    const file = files[0]!;
    expect(file.oldPath).toBe('src/app.swift');
    expect(file.newPath).toBe('src/app.swift');
    expect(file.hunks).toHaveLength(2);
    expect(file.additions).toBe(3);
    expect(file.deletions).toBe(2);
    const hunk = file.hunks[0]!;
    expect([hunk.oldStart, hunk.oldCount, hunk.newStart, hunk.newCount]).toEqual([1, 4, 1, 5]);
    expect(hunk.section).toBe('struct App');
    expect(hunk.header).toBe('@@ -1,4 +1,5 @@ struct App');
    expect(kinds(hunk.lines)).toEqual(['context', 'deletion', 'addition', 'addition', 'context', 'context']);
    expect([hunk.lines[1]!.oldNumber, hunk.lines[1]!.newNumber]).toEqual([2, null]);
    expect(hunk.lines[3]!.newNumber).toBe(3);
    expect([hunk.lines[4]!.oldNumber, hunk.lines[4]!.newNumber]).toEqual([3, 4]);
    expect(kinds(file.hunks[1]!.lines)).toEqual([
      'context',
      'deletion',
      'noNewline',
      'addition',
      'noNewline',
    ]);
    expect(supportsPartialStaging(file)).toBe(true);
    expect(files[1]!.isBinary).toBe(true);
    expect(supportsPartialStaging(files[1]!)).toBe(false);
  });

  it('parsesNewDeletedAndRenamedHeaders', () => {
    const files = parseDiff(
      utf8(
        lines(
          'diff --git a/new.txt b/new.txt',
          'new file mode 100644',
          'index 0000000..1111111',
          '--- /dev/null',
          '+++ b/new.txt',
          '@@ -0,0 +1,2 @@',
          '+a',
          '+b',
          'diff --git a/old name.txt b/new name.txt',
          'similarity index 90%',
          'rename from old name.txt',
          'rename to new name.txt',
          'index 1..2 100644',
          '--- a/old name.txt',
          '+++ b/new name.txt',
          '@@ -1 +1 @@',
          '-x',
          '+y',
          'diff --git a/run.sh b/run.sh',
          'old mode 100644',
          'new mode 100755',
        ),
      ),
    );
    expect(files).toHaveLength(3);
    const [created, renamed, modeOnly] = files;
    expect(created!.isNewFile).toBe(true);
    expect(created!.oldPath).toBeNull();
    expect(created!.newPath).toBe('new.txt');
    expect(created!.newMode).toBe('100644');
    expect(supportsPartialStaging(created!)).toBe(false);
    expect([renamed!.oldPath, renamed!.newPath, renamed!.similarity]).toEqual([
      'old name.txt',
      'new name.txt',
      90,
    ]);
    expect([renamed!.hunks[0]!.oldCount, renamed!.hunks[0]!.newCount]).toEqual([1, 1]);
    expect(isModeChangeOnly(modeOnly!)).toBe(true);
    expect([modeOnly!.oldMode, modeOnly!.newMode]).toEqual(['100644', '100755']);
  });

  it('inlineHighlightFindsChangedMiddle (qua hunk thô)', () => {
    const hunk = parseDiff(utf8(sample))[0]!.hunks[0]!;
    const highlights = hunkHighlights(hunk);
    expect(highlights.get(1)).toEqual({ start: 8, end: 9 });
    expect(highlights.get(2)).toEqual({ start: 8, end: 9 });
    expect(highlights.size).toBe(2);
  });
});

describe('parseDiff theo byte (FM2/FM8/AD9)', () => {
  const header = ['diff --git a/f.txt b/f.txt', 'index 1..2 100644', '--- a/f.txt', '+++ b/f.txt'];

  it('tách dòng chỉ theo "\\n", giữ "\\r" trong dòng — dòng CRLF không bị dính nhau (bug của bản Swift)', () => {
    const diff = utf8(`${header.join('\n')}\n@@ -1,3 +1,3 @@\n a\r\n-b\r\n+c\r\n d\r\n`);
    const [file] = parseDiff(diff);
    const hunk = file!.hunks[0]!;
    expect(hunk.lines).toHaveLength(4);
    expect(kinds(hunk.lines)).toEqual(['context', 'deletion', 'addition', 'context']);
    expect(hunk.lines.map((line) => showBytes(line.text))).toEqual(['a\\r', 'b\\r', 'c\\r', 'd\\r']);
    expect([hunk.lines[2]!.oldNumber, hunk.lines[2]!.newNumber]).toEqual([null, 2]);
    expect([file!.additions, file!.deletions]).toEqual([1, 1]);
  });

  it('"\\r" giữa dòng và "\\r" đứng một mình đều là nội dung', () => {
    const [file] = parseDiff(utf8(`${header.join('\n')}\n@@ -1 +1 @@\n-a\rb\r\r\n+c\r\n`));
    expect(file!.hunks[0]!.lines.map((line) => showBytes(line.text))).toEqual(['a\\rb\\r\\r', 'c\\r']);
  });

  it('byte không phải UTF-8 (CP1252/CP1258) giữ nguyên từng byte', () => {
    const body = latin1('@@ -1,2 +1,2 @@\n caf\xe9\n-Vi\xea\xf2t\n+Vi\xea\xf2t Nam\xd0\n');
    const raw = new Uint8Array([...utf8(`${header.join('\n')}\n`), ...body]);
    const [file] = parseDiff(raw);
    const [context, deletion, addition] = file!.hunks[0]!.lines;
    expect([...context!.text]).toEqual([0x63, 0x61, 0x66, 0xe9]);
    expect([...deletion!.text]).toEqual([0x56, 0x69, 0xea, 0xf2, 0x74]);
    expect([...addition!.text].slice(-2)).toEqual([0x6d, 0xd0]);
    // Giải mã lỏng sẽ làm hỏng: chứng minh vì sao patch phải dựng từ byte.
    expect(decodeUtf8Lossy(context!.text)).toContain('\ufffd');
  });

  it('nội dung dòng là view vào buffer đầu vào (không sao chép)', () => {
    const raw = utf8(`${header.join('\n')}\n@@ -1 +1 @@\n-a\n+b\n`);
    const [file] = parseDiff(raw);
    expect(file!.hunks[0]!.lines[0]!.text.buffer).toBe(raw.buffer);
  });

  it('đầu vào không có "\\n" cuối vẫn parse dòng cuối; rỗng/rác trước "diff --git" bị bỏ qua', () => {
    expect(parseDiff(new Uint8Array())).toEqual([]);
    expect(parseDiff(utf8('lời nhắn rác\nkhông phải diff\n'))).toEqual([]);
    const [file] = parseDiff(utf8(`rác\n${header.join('\n')}\n@@ -1 +1 @@\n-a\n+b`));
    expect(file!.hunks[0]!.lines.map((line) => text(line.text))).toEqual(['a', 'b']);
  });

  it('"\\ No newline at end of file": dòng đánh dấu giữ vị trí, không tính vào đếm số dòng', () => {
    const [file] = parseDiff(
      utf8(`${header.join('\n')}\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+b\n`),
    );
    const hunk = file!.hunks[0]!;
    expect(kinds(hunk.lines)).toEqual(['context', 'deletion', 'noNewline', 'addition']);
    expect(text(hunk.lines[2]!.text)).toBe('No newline at end of file');
    expect([hunk.lines[2]!.oldNumber, hunk.lines[2]!.newNumber]).toEqual([null, null]);
    expect(hunk.lines[3]!.newNumber).toBe(2);
    expect(diffLineCount(file!)).toBe(4);
  });

  it('hunk rỗng và header hunk hỏng: bỏ qua dòng của hunk hỏng cho tới "@@" kế tiếp', () => {
    const [file] = parseDiff(
      utf8(
        `${header.join('\n')}\n@@ -1,0 +1,0 @@\n@@ không phải header @@\n-bị bỏ qua\n+bị bỏ qua\n@@ -5,2 +5,2 @@ hàm\n a\n-b\n+c\n`,
      ),
    );
    expect(file!.hunks.map((hunk) => [hunk.id, hunk.oldStart, hunk.lines.length])).toEqual([
      [0, 1, 0],
      [1, 5, 3],
    ]);
    expect(file!.hunks[1]!.section).toBe('hàm');
    expect([file!.additions, file!.deletions]).toEqual([1, 1]);
  });

  it('dòng rỗng hoàn toàn trong hunk bị bỏ qua như bản Swift, dòng lạ cũng vậy', () => {
    const [file] = parseDiff(utf8(`${header.join('\n')}\n@@ -1,2 +1,2 @@\n a\n\n?lạ\n-b\n+c\n`));
    expect(kinds(file!.hunks[0]!.lines)).toEqual(['context', 'deletion', 'addition']);
    // Số dòng vẫn đúng: dòng bị bỏ không làm lệch bộ đếm.
    expect(file!.hunks[0]!.lines[1]!.oldNumber).toBe(2);
  });

  it('nhiều file, header nhị phân (Binary files / GIT binary patch), rename có ngoặc kép và TAB', () => {
    const [binary, gitBinary, renamed, deleted] = parseDiff(
      utf8(
        lines(
          'diff --git a/a.png b/a.png',
          'index 1..2 100644',
          'Binary files a/a.png and b/a.png differ',
          'diff --git a/b.bin b/b.bin',
          'index 1..2 100644',
          'GIT binary patch',
          'literal 4',
          'Lc$@;SXxzs}',
          '',
          'diff --git "a/t\\303\\240i li\\341\\273\\207u.txt" "b/m\\341\\273\\233i.txt"',
          'similarity index 100%',
          'rename from "t\\303\\240i li\\341\\273\\207u.txt"',
          'rename to "m\\341\\273\\233i.txt"',
          'diff --git a/x.txt b/x.txt',
          'deleted file mode 100644',
          'index 1..0000000',
          '--- a/x.txt',
          '+++ /dev/null',
          '@@ -1 +0,0 @@',
          '-x',
        ),
      ),
    );
    expect(binary!.isBinary).toBe(true);
    expect(supportsPartialStaging(binary!)).toBe(false);
    expect(gitBinary!.isBinary).toBe(true);
    expect(gitBinary!.hunks).toHaveLength(0);
    expect([renamed!.oldPath, renamed!.newPath, renamed!.similarity]).toEqual([
      'tài liệu.txt',
      'mới.txt',
      100,
    ]);
    expect(isModeChangeOnly(renamed!)).toBe(false);
    expect(deleted!.isDeletedFile).toBe(true);
    expect([deleted!.oldPath, deleted!.newPath, deleted!.oldMode]).toEqual(['x.txt', null, '100644']);
    expect(supportsPartialStaging(deleted!)).toBe(false);
  });

  it('đường dẫn có dấu cách: git thêm TAB cuối dòng ---/+++, bỏ TAB và tiền tố a/ b/', () => {
    const [file] = parseDiff(
      utf8(
        lines(
          'diff --git a/ghi chú.txt b/ghi chú.txt',
          'index 1..2 100644',
          '--- a/ghi chú.txt\t',
          '+++ b/ghi chú.txt\t',
          '@@ -1 +1 @@',
          '-a',
          '+b',
        ),
      ),
    );
    expect([file!.oldPath, file!.newPath]).toEqual(['ghi chú.txt', 'ghi chú.txt']);
  });

  it('đổi quyền kèm sửa nội dung: giữ oldMode/newMode, không phải "chỉ đổi mode"', () => {
    const [file] = parseDiff(
      utf8(
        lines(
          'diff --git a/r.sh b/r.sh',
          'old mode 100644',
          'new mode 100755',
          'index 1..2',
          '--- a/r.sh',
          '+++ b/r.sh',
          '@@ -1 +1 @@',
          '-a',
          '+b',
        ),
      ),
    );
    expect([file!.oldMode, file!.newMode]).toEqual(['100644', '100755']);
    expect(isModeChangeOnly(file!)).toBe(false);
    expect(supportsPartialStaging(file!)).toBe(true);
    expect(file!.headerLines.map((line) => text(line))).toContain('old mode 100644');
  });

  it('headerLines giữ nguyên byte từng dòng header (dùng lại khi dựng patch)', () => {
    const [file] = parseDiff(utf8(sample));
    expect(file!.headerLines.map((line) => text(line))).toEqual([
      'diff --git a/src/app.swift b/src/app.swift',
      'index 1111111..2222222 100644',
      '--- a/src/app.swift',
      '+++ b/src/app.swift',
    ]);
  });

  it('changeLineIndices / isChangeLine chỉ tính dòng thêm-xoá', () => {
    const hunk = parseDiff(utf8(sample))[0]!.hunks[0]!;
    expect(changeLineIndices(hunk)).toEqual([1, 2, 3]);
    expect(hunk.lines.filter(isChangeLine)).toHaveLength(3);
  });
});

describe('parseHunkHeader', () => {
  it('số dòng mặc định là 1 khi bỏ ",count"; section sau " @@" được cắt khoảng trắng', () => {
    expect(parseHunkHeader('@@ -1 +1 @@')).toEqual({
      oldStart: 1,
      oldCount: 1,
      newStart: 1,
      newCount: 1,
      section: '',
    });
    expect(parseHunkHeader('@@ -0,0 +1,2 @@ func foo() @@ bar  ')).toEqual({
      oldStart: 0,
      oldCount: 0,
      newStart: 1,
      newCount: 2,
      section: 'func foo() @@ bar',
    });
  });

  it('từ chối header sai', () => {
    for (const bad of [
      '@@ -1,2 +1,2',
      '@@ 1,2 +1,2 @@',
      '@@ -a +1 @@',
      '@@ -1 @@',
      '@@ -1 +1 +2 @@',
      '@@ -1,2 +x @@',
      '@@  @@',
    ]) {
      expect(parseHunkHeader(bad), bad).toBeNull();
    }
  });

  it('count không đọc được thì coi là 1 (như Swift)', () => {
    expect(parseHunkHeader('@@ -3,x +4,y @@')).toMatchObject({
      oldStart: 3,
      oldCount: 1,
      newStart: 4,
      newCount: 1,
    });
  });
});

describe('unquoteGitPath', () => {
  it('giải mã escape kiểu C và bát phân UTF-8', () => {
    expect(unquoteGitPath('"a\\tb\\"c\\\\d"')).toBe('a\tb"c\\d');
    expect(unquoteGitPath('"\\303\\251.txt"')).toBe('é.txt');
    expect(unquoteGitPath('"\\n\\r\\a\\b\\f\\v"')).toBe('\n\r\u0007\b\f\v');
  });

  it('không có ngoặc kép → giữ nguyên; thiếu ngoặc đóng → giữ nguyên', () => {
    expect(unquoteGitPath('plain.txt')).toBe('plain.txt');
    expect(unquoteGitPath('"abc')).toBe('"abc');
    expect(unquoteGitPath('"')).toBe('"');
  });

  it('dấu "\\" cuối chuỗi (không có ký tự đi kèm) giữ nguyên; bát phân tràn byte không gây lỗi', () => {
    expect(unquoteGitPath('"ab\\"')).toBe('ab\\');
    expect(unquoteGitPath('"\\777"')).toBe('\ufffd');
  });
});

describe('hiệu năng (chặn hồi quy O(n²); ngưỡng rất rộng)', () => {
  it('parse + dựng patch + trình bày diff 60.000 dòng (~3 MB) dưới 3 giây', async () => {
    const { buildPresentation, makePatch, selectionForWholeHunk } = await import('../src/diff/index.ts');
    const body: string[] = [
      'diff --git a/big.txt b/big.txt',
      'index 1..2 100644',
      '--- a/big.txt',
      '+++ b/big.txt',
      '@@ -1,30000 +1,30000 @@',
    ];
    for (let i = 0; i < 30_000; i++) body.push(`-dòng cũ số ${i} với một ít chữ để dài hơn\t(tab)`);
    for (let i = 0; i < 30_000; i++) body.push(`+dòng mới số ${i} với một ít chữ để dài hơn\t(tab)`);
    const bytes = utf8(`${body.join('\n')}\n`);
    expect(bytes.length).toBeGreaterThan(2_500_000);

    const start = performance.now();
    const [file] = parseDiff(bytes);
    expect(diffLineCount(file!)).toBe(60_000);
    const patch = makePatch(file!, selectionForWholeHunk(file!.hunks[0]!), false);
    expect(patch!.length).toBeGreaterThan(2_500_000);
    const presentation = buildPresentation(file!);
    expect(presentation.hunks[0]!.splitRows).toHaveLength(30_000);
    expect(performance.now() - start).toBeLessThan(3000);
  });
});
