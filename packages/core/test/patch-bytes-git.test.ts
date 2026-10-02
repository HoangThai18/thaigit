// Patch dựng từ byte, áp bằng git THẬT trong repo tạm (cô lập cấu hình), so sánh BYTE của blob index và file
// working tree. Gồm: bản port các test staging dòng của RepositoryTests.swift, ca "không newline cuối file",
// CRLF, CP1252/CP1258, BOM, đổi tên, mode, -U0, parse output git thật và một ca đối chứng (test phải có thể fail).

import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type DiffHunk,
  type DiffLine,
  type FileDiff,
  isChangeLine,
  makePatch,
  parseDiff,
  selectionForWholeHunk,
  supportsPartialStaging,
} from '../src/diff/index.ts';
import { decodeUtf8Lossy } from '../src/support/text.ts';
import { type AutoCrlf, TempRepo, latin1, showBytes, utf8 } from './helpers/git-cli.ts';

const repos: TempRepo[] = [];
function newRepo(autocrlf: AutoCrlf = 'false'): TempRepo {
  const repo = TempRepo.create({ autocrlf });
  repos.push(repo);
  return repo;
}
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

type Op = 'stage' | 'unstage' | 'discard';
type Pick = (line: DiffLine, text: string, hunk: DiffHunk) => boolean;

function firstDiff(repo: TempRepo, kind: 'unstaged' | 'staged', relative: string, context = 3): FileDiff {
  const [file] = parseDiff(repo.diffBytes(kind, relative, context));
  if (!file) throw new Error(`không có diff cho ${relative}`);
  return file;
}

function selectLines(file: FileDiff, pick: Pick): Map<number, Set<number>> {
  const selection = new Map<number, Set<number>>();
  for (const hunk of file.hunks) {
    const indices = new Set<number>();
    hunk.lines.forEach((line, index) => {
      if (isChangeLine(line) && pick(line, decodeUtf8Lossy(line.text), hunk)) indices.add(index);
    });
    if (indices.size > 0) selection.set(hunk.id, indices);
  }
  return selection;
}

/** Dựng patch từ diff hiện tại rồi áp bằng git như app: stage = xuôi vào index, unstage = ngược vào index, huỷ = ngược vào worktree. */
function runOp(repo: TempRepo, op: Op, relative: string, pick: Pick): Uint8Array {
  const file = firstDiff(repo, op === 'unstage' ? 'staged' : 'unstaged', relative);
  const patch = makePatch(file, selectLines(file, pick), op !== 'stage');
  if (patch === null) throw new Error('không dựng được patch');
  const result = repo.applyPatch(patch, { cached: op !== 'discard', reverse: op !== 'stage' });
  if (result.code !== 0) throw new Error(`git apply thất bại: ${result.stderr}\n${showBytes(patch)}`);
  return patch;
}

const textIs =
  (...texts: string[]): Pick =>
  (_line, text) =>
    texts.includes(text);

function expectBytes(actual: Uint8Array, expected: Uint8Array | string): void {
  const want = typeof expected === 'string' ? utf8(expected) : expected;
  expect(showBytes(actual)).toBe(showBytes(want));
}

const kindsOf = (hunk: DiffHunk): string[] => hunk.lines.map((line) => line.kind);
const textsOf = (hunk: DiffHunk, kind?: string): string[] =>
  hunk.lines
    .filter((line) => kind === undefined || line.kind === kind)
    .map((line) => decodeUtf8Lossy(line.text));

describe('port RepositoryTests.swift: stage/unstage/huỷ theo hunk và dòng', () => {
  it('partialStagingOfHunksAndLines', () => {
    const repo = newRepo();
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    repo.writeFile('f.txt', `${lines.join('\n')}\n`);
    repo.add('f.txt');
    repo.commit('init');

    // Hai vùng thay đổi cách xa nhau → hai hunk.
    lines[1] = 'LINE TWO';
    lines[19] = 'LINE TWENTY';
    lines.splice(20, 0, 'inserted after 20');
    repo.writeFile('f.txt', `${lines.join('\n')}\n`);

    let diff = firstDiff(repo, 'unstaged', 'f.txt');
    expect(diff.hunks).toHaveLength(2);

    // Stage nguyên hunk thứ hai.
    const patch = makePatch(diff, selectionForWholeHunk(diff.hunks[1]!), false)!;
    expect(repo.applyPatch(patch, { cached: true, reverse: false }).code).toBe(0);
    let staged = firstDiff(repo, 'staged', 'f.txt');
    expect(staged.hunks).toHaveLength(1);
    expect(textsOf(staged.hunks[0]!, 'addition')).toContain('LINE TWENTY');
    expect(textsOf(staged.hunks[0]!)).not.toContain('LINE TWO');
    diff = firstDiff(repo, 'unstaged', 'f.txt');
    expect(diff.hunks).toHaveLength(1);
    expect(textsOf(diff.hunks[0]!)).toContain('LINE TWO');

    // Unstage riêng dòng "inserted after 20" (áp ngược vào index).
    runOp(repo, 'unstage', 'f.txt', textIs('inserted after 20'));
    staged = firstDiff(repo, 'staged', 'f.txt');
    expect(textsOf(staged.hunks[0]!, 'addition')).toContain('LINE TWENTY');
    expect(textsOf(staged.hunks[0]!, 'addition')).not.toContain('inserted after 20');

    // Stage riêng dòng thêm "LINE TWO" nhưng không stage dòng xoá "line 2".
    runOp(repo, 'stage', 'f.txt', (line, text) => line.kind === 'addition' && text === 'LINE TWO');
    expect(decodeUtf8Lossy(repo.indexBlob('f.txt'))).toContain('line 2\nLINE TWO\nline 3');

    // Huỷ (discard) dòng "inserted after 20" khỏi working tree.
    runOp(repo, 'discard', 'f.txt', (line, text) => line.kind === 'addition' && text === 'inserted after 20');
    const working = decodeUtf8Lossy(repo.readFile('f.txt'));
    expect(working).not.toContain('inserted after 20');
    expect(working).toContain('LINE TWENTY');
    expect(working).toContain('LINE TWO');
  });

  it('partialStagingNearEndOfFileWithoutNewline', () => {
    const repo = newRepo();
    repo.writeFile('g.txt', 'a\nb\nc');
    repo.add('g.txt');
    repo.commit('init');
    repo.writeFile('g.txt', 'a\nB\nc\nd');
    runOp(repo, 'stage', 'g.txt', textIs('b', 'B'));
    expectBytes(repo.indexBlob('g.txt'), 'a\nB\nc');
  });

  it('partialStagingAddsLineAfterMissingNewline', () => {
    const repo = newRepo();
    repo.writeFile('g.txt', 'a\nb\nc');
    repo.add('g.txt');
    repo.commit('init');
    repo.writeFile('g.txt', 'a\nB\nc\nd');
    runOp(repo, 'stage', 'g.txt', textIs('b', 'B', 'd'));
    expectBytes(repo.indexBlob('g.txt'), 'a\nB\nc\nd');
  });

  it('lineSelectionKeepsLineOrder', () => {
    const repo = newRepo();
    repo.writeFile('p.txt', 'top\na\nb\nmid\nfoo\nbaz\nend\n');
    repo.add('p.txt');
    repo.commit('init');
    repo.writeFile('p.txt', 'top\nA\nB\nmid\nbar\nend\n');

    // Stage cặp thứ hai (b → B) và việc sửa foo → bar, giữ nguyên a và baz.
    runOp(repo, 'stage', 'p.txt', textIs('b', 'B', 'foo', 'bar'));
    expectBytes(repo.indexBlob('p.txt'), 'top\na\nB\nmid\nbar\nbaz\nend\n');

    // Huỷ trong working tree cặp a → A (khôi phục "a"), giữ các thay đổi còn lại.
    runOp(repo, 'discard', 'p.txt', textIs('a', 'A'));
    expectBytes(repo.readFile('p.txt'), 'top\na\nB\nmid\nbar\nend\n');

    // Unstage riêng việc sửa b → B khỏi index.
    runOp(repo, 'unstage', 'p.txt', textIs('b', 'B'));
    expectBytes(repo.indexBlob('p.txt'), 'top\na\nb\nmid\nbar\nbaz\nend\n');
  });
});

describe('"\\ No newline at end of file": các tổ hợp làm hỏng dữ liệu âm thầm ở bản Swift', () => {
  it('stage riêng dòng thêm cuối-file-không-newline, giữ hai dòng xoá làm ngữ cảnh (trước: "x1\\ny1x2\\n")', () => {
    const repo = newRepo();
    repo.writeFile('d.txt', 'x1\nx2\n');
    repo.add('d.txt');
    repo.commit('base');
    repo.writeFile('d.txt', 'y1');
    runOp(repo, 'stage', 'd.txt', (line) => line.kind === 'addition');
    expectBytes(repo.indexBlob('d.txt'), 'x1\nx2\ny1');
    expectBytes(repo.readFile('d.txt'), 'y1');
  });

  it('unstage riêng dòng xoá cuối-file-không-newline, giữ hai dòng thêm làm ngữ cảnh (trước: "x1y1\\ny2\\n")', () => {
    const repo = newRepo();
    repo.writeFile('d.txt', 'x1');
    repo.add('d.txt');
    repo.commit('base');
    repo.writeFile('d.txt', 'y1\ny2\n');
    repo.add('d.txt');
    runOp(repo, 'unstage', 'd.txt', (line) => line.kind === 'deletion');
    expectBytes(repo.indexBlob('d.txt'), 'y1\ny2\nx1');
    expectBytes(repo.readFile('d.txt'), 'y1\ny2\n');
  });

  it('unstage riêng hai dòng xoá khi dòng thêm cuối file không có newline: "y1" được thêm newline', () => {
    const repo = newRepo();
    repo.writeFile('d.txt', 'x1\nx2\n');
    repo.add('d.txt');
    repo.commit('base');
    repo.writeFile('d.txt', 'y1');
    repo.add('d.txt');
    runOp(repo, 'unstage', 'd.txt', (line) => line.kind === 'deletion');
    expectBytes(repo.indexBlob('d.txt'), 'x1\ny1\nx2\n');
  });

  it('stage riêng dòng thêm sau dòng cũ không có newline: dòng cũ nhận newline, không bị nối', () => {
    const repo = newRepo();
    repo.writeFile('d.txt', 'x1');
    repo.add('d.txt');
    repo.commit('base');
    repo.writeFile('d.txt', 'y1\ny2\n');
    runOp(repo, 'stage', 'd.txt', textIs('y2'));
    expectBytes(repo.indexBlob('d.txt'), 'x1\ny2\n');
  });

  it('file CRLF thiếu newline cuối + thêm dòng mới: chỉ stage dòng mới → index khớp worktree từng byte (không "\\n" lẻ)', () => {
    const repo = newRepo();
    repo.writeFile('c.txt', 'a\r\nb\r\nc');
    repo.add('c.txt');
    repo.commit('base');
    repo.writeFile('c.txt', 'a\r\nb\r\nc\r\nd');
    runOp(repo, 'stage', 'c.txt', textIs('d'));
    expectBytes(repo.indexBlob('c.txt'), 'a\r\nb\r\nc\r\nd');
    expect(repo.diffBytes('unstaged', 'c.txt')).toHaveLength(0);
  });

  it('đổi trạng thái newline cuối file thuần tuý: stage được phần đổi', () => {
    const repo = newRepo();
    repo.writeFile('e.txt', 'a\nb');
    repo.add('e.txt');
    repo.commit('base');
    repo.writeFile('e.txt', 'a\nb\n');
    expect(kindsOf(firstDiff(repo, 'unstaged', 'e.txt').hunks[0]!)).toEqual([
      'context',
      'deletion',
      'noNewline',
      'addition',
    ]);
    runOp(repo, 'stage', 'e.txt', () => true);
    expectBytes(repo.indexBlob('e.txt'), 'a\nb\n');
  });
});

describe('-U0, đổi tên, đổi quyền', () => {
  it('diff -U0: patch không ngữ cảnh bị git từ chối trừ khi có --unidiff-zero (nơi gọi phải truyền cờ khi context = 0)', () => {
    const repo = newRepo();
    repo.writeFile('d.txt', 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n');
    repo.add('d.txt');
    repo.commit('base');
    repo.writeFile('d.txt', 'l1\nL2\nl3\nl4\nl5\nl6\nl7\nl8\nL9\nl10\n');
    const [file] = parseDiff(repo.diffBytes('unstaged', 'd.txt', 0));
    expect(file!.hunks).toHaveLength(2);
    const patch = makePatch(file!, selectionForWholeHunk(file!.hunks[1]!), false)!;
    expect(repo.applyPatch(patch, { cached: true, reverse: false }).code).not.toBe(0);
    repo.git('apply', ['--whitespace=nowarn', '--recount', '--cached', '--unidiff-zero', '-'], {
      stdin: patch,
    });
    expectBytes(repo.indexBlob('d.txt'), 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nL9\nl10\n');
  });

  it('diff -U0 + --unidiff-zero: stage cả hai hunk rồi unstage riêng một hunk, đúng vị trí', () => {
    const repo = newRepo();
    repo.writeFile('d.txt', 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n');
    repo.add('d.txt');
    repo.commit('base');
    // Hunk 0 chèn 2 dòng (lệch +2), hunk 1 xoá dòng l9.
    repo.writeFile('d.txt', 'l1\nl2\nNEW1\nNEW2\nl3\nl4\nl5\nl6\nl7\nl8\nl10\n');
    const apply = (patch: Uint8Array, reverse: boolean) =>
      repo.git(
        'apply',
        [
          '--whitespace=nowarn',
          '--recount',
          '--cached',
          '--unidiff-zero',
          ...(reverse ? ['--reverse'] : []),
          '-',
        ],
        {
          stdin: patch,
        },
      );

    const [unstaged] = parseDiff(repo.diffBytes('unstaged', 'd.txt', 0));
    expect(unstaged!.hunks).toHaveLength(2);
    const everything = new Map(unstaged!.hunks.flatMap((hunk) => [...selectionForWholeHunk(hunk)]));
    apply(makePatch(unstaged!, everything, false)!, false);
    expectBytes(repo.indexBlob('d.txt'), 'l1\nl2\nNEW1\nNEW2\nl3\nl4\nl5\nl6\nl7\nl8\nl10\n');
    repo.commit('all');

    repo.writeFile('d.txt', 'L1\nl2\nNEW1\nNEW2\nl3\nl4\nl5\nl6\nl7\nl8\nL10\n');
    repo.add('d.txt');
    const [staged] = parseDiff(repo.diffBytes('staged', 'd.txt', 0));
    expect(staged!.hunks).toHaveLength(2);
    apply(makePatch(staged!, selectionForWholeHunk(staged!.hunks[1]!), true)!, true);
    expectBytes(repo.indexBlob('d.txt'), 'L1\nl2\nNEW1\nNEW2\nl3\nl4\nl5\nl6\nl7\nl8\nl10\n');
  });

  it('unstage vài dòng của file đã đổi tên + sửa: việc đổi tên vẫn nằm trong index (trước: mất b.txt khỏi index)', () => {
    const repo = newRepo();
    repo.writeFile('a.txt', 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n');
    repo.add('a.txt');
    repo.commit('base');
    repo.git('mv', ['a.txt', 'b.txt']);
    repo.writeFile('b.txt', 'l1\nL2\nl3\nl4\nl5\nl6\nl7\nl8\nL9\nl10\n');
    repo.add('b.txt');

    // Như app: truyền cả đường dẫn cũ và mới để git ghép cặp đổi tên.
    const diff = repo.git('diff', [
      '--cached',
      '-M',
      '--no-color',
      '-U3',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--',
      'a.txt',
      'b.txt',
    ]).stdout;
    const [renamed] = parseDiff(diff);
    expect([renamed!.oldPath, renamed!.newPath]).toEqual(['a.txt', 'b.txt']);
    expect(supportsPartialStaging(renamed!)).toBe(true);
    const patch = makePatch(renamed!, selectLines(renamed!, textIs('l2', 'L2')), true)!;
    expect(decodeUtf8Lossy(patch)).not.toContain('rename');
    const result = repo.applyPatch(patch, { cached: true, reverse: true });
    expect(result.code, result.stderr).toBe(0);
    expect(decodeUtf8Lossy(repo.git('status', ['--porcelain']).stdout)).toBe('RM a.txt -> b.txt\n');
    expectBytes(repo.indexBlob('b.txt'), 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nL9\nl10\n');
  });

  it('đổi tên có dấu cách + tiếng Việt (TAB cuối dòng ---/+++): unstage một dòng vẫn đúng', () => {
    const repo = newRepo();
    const from = 'Tài liệu/ghi chú.txt'.normalize('NFC');
    const to = 'Tài liệu/ghi chú mới.txt'.normalize('NFC');
    repo.writeFile(from, 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n');
    repo.add(from);
    repo.commit('base');
    repo.git('mv', [from, to]);
    repo.writeFile(to, 'l1\nL2\nl3\nl4\nl5\nl6\nl7\nl8\nL9\nl10\n');
    repo.add(to);
    const diff = repo.git('diff', [
      '--cached',
      '-M',
      '--no-color',
      '-U3',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--',
      from,
      to,
    ]).stdout;
    const [renamed] = parseDiff(diff);
    expect([renamed!.oldPath, renamed!.newPath]).toEqual([from, to]);
    const patch = makePatch(renamed!, selectLines(renamed!, textIs('l9', 'L9')), true)!;
    const result = repo.applyPatch(patch, { cached: true, reverse: true });
    expect(result.code, result.stderr).toBe(0);
    expectBytes(repo.indexBlob(to), 'l1\nL2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n');
    // `status --porcelain` đặt tên có dấu cách trong ngoặc kép; chỉ cần thấy "R" ở index và "M" ở worktree.
    const status = decodeUtf8Lossy(repo.git('status', ['--porcelain']).stdout);
    expect(status.startsWith('RM ')).toBe(true);
    expect(status).toContain('ghi chú mới.txt');
  });

  it.skipIf(process.platform === 'win32')(
    'stage vài dòng của file vừa đổi quyền: quyền file không bị kéo theo vào index',
    () => {
      const repo = newRepo();
      repo.writeFile('r.sh', 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n');
      repo.add('r.sh');
      repo.commit('base');
      repo.writeFile('r.sh', 'a\nB\nc\nd\ne\nf\ng\nh\nI\nj\n');
      chmodSync(join(repo.dir, 'r.sh'), 0o755);
      const file = firstDiff(repo, 'unstaged', 'r.sh');
      expect([file.oldMode, file.newMode]).toEqual(['100644', '100755']);
      runOp(repo, 'stage', 'r.sh', textIs('b', 'B'));
      expect(decodeUtf8Lossy(repo.git('ls-files', ['-s', 'r.sh']).stdout).startsWith('100644 ')).toBe(true);
      expectBytes(repo.indexBlob('r.sh'), 'a\nB\nc\nd\ne\nf\ng\nh\ni\nj\n');
    },
  );
});

describe('byte không phải UTF-8: CP1252 / CP1258 (không bao giờ qua giải mã)', () => {
  // Mỗi chuỗi là "latin1" (một ký tự = một byte) — nội dung thật khi file lưu CP1252/CP1258.
  const datasets = {
    CP1252: {
      base: ['caf\xe9 un', 'na\xefve deux', 'tr\xe8s trois', '\xe0 quatre', 'fin'],
      edit1: 'na\xefve DEUX\xa4',
      edit3: '\xe0 QUATRE\xd0',
    },
    // "Xin chào Việt Nam": ê = 0xEA, dấu nặng kết hợp = 0xF2, à = 0xE0, Đ = 0xD0.
    CP1258: {
      base: ['Xin ch\xe0o', 'Vi\xea\xf2t Nam', '\xd0\xe0 N\xeang', 'H\xe0 N\xf2i', 'h\xea\xf2t'],
      edit1: 'Vi\xea\xf2t NAM \xea',
      edit3: 'H\xe0 N\xf2i \xd0',
    },
  } as const;
  const bytesEqual = (a: Uint8Array, b: Uint8Array) =>
    a.length === b.length && a.every((value, i) => value === b[i]);

  for (const [name, data] of Object.entries(datasets)) {
    // autocrlf=true: index LF, worktree CRLF (như Windows); các cấu hình khác: LF cả hai.
    for (const autocrlf of ['false', 'input', 'true'] as const) {
      it(`${name}, autocrlf=${autocrlf}: stage / unstage / huỷ đúng một dòng, mọi byte khác nguyên vẹn`, () => {
        const eol = autocrlf === 'true' ? '\r\n' : '\n';
        const join = (lines: readonly string[], ending: string) =>
          latin1(lines.map((line) => line + ending).join(''));
        const baseLines = [...data.base];
        const bothEdited = baseLines.map((line, i) => (i === 1 ? data.edit1 : i === 3 ? data.edit3 : line));
        const firstOnly = baseLines.map((line, i) => (i === 1 ? data.edit1 : line));
        const thirdOnly = baseLines.map((line, i) => (i === 3 ? data.edit3 : line));
        const firstChange: Pick = (line) =>
          [data.base[1], data.edit1].some((text) => bytesEqual(line.text, latin1(text)));

        const prepare = (op: Op): TempRepo => {
          const repo = newRepo('false');
          repo.writeFile('t.txt', join(baseLines, '\n'));
          repo.add('t.txt');
          repo.commit('base');
          repo.setAutocrlf(autocrlf);
          repo.removeFile('t.txt');
          repo.git('checkout', ['--', 't.txt']);
          repo.writeFile('t.txt', join(bothEdited, eol));
          if (op === 'unstage') repo.add('t.txt');
          return repo;
        };

        const staged = prepare('stage');
        runOp(staged, 'stage', 't.txt', firstChange);
        expectBytes(staged.indexBlob('t.txt'), join(firstOnly, '\n'));
        expectBytes(staged.readFile('t.txt'), join(bothEdited, eol));

        const unstaged = prepare('unstage');
        runOp(unstaged, 'unstage', 't.txt', firstChange);
        expectBytes(unstaged.indexBlob('t.txt'), join(thirdOnly, '\n'));
        expectBytes(unstaged.readFile('t.txt'), join(bothEdited, eol));

        const discarded = prepare('discard');
        runOp(discarded, 'discard', 't.txt', firstChange);
        expectBytes(discarded.readFile('t.txt'), join(thirdOnly, eol));
        expectBytes(discarded.indexBlob('t.txt'), join(baseLines, '\n'));
      });
    }
  }

  it('đối chứng: đi qua giải mã UTF-8 lỏng rồi mã hoá lại sẽ làm hỏng byte (đây là lý do patch dựng từ byte)', () => {
    const original = latin1(datasets.CP1252.base.join('\n'));
    const roundTrip = new TextEncoder().encode(new TextDecoder().decode(original));
    expect(bytesEqual(original, roundTrip)).toBe(false);
  });
});

describe('BOM UTF-8 + CRLF', () => {
  const BOM = 'ï»¿'; // ba byte EF BB BF dưới dạng "latin1"
  const bom = (lines: string[]): Uint8Array => latin1(BOM + lines.map((line) => `${line}\r\n`).join(''));

  it('stage / unstage / huỷ dòng đầu (dòng chứa BOM): BOM và "\\r\\n" giữ nguyên từng byte', () => {
    const first: Pick = (_line, text) => text === '﻿first\r' || text === '﻿FIRST\r';
    const prepare = (op: Op): TempRepo => {
      const repo = newRepo();
      repo.writeFile('b.txt', bom(['first', 'second', 'third']));
      repo.add('b.txt');
      repo.commit('base');
      repo.writeFile('b.txt', bom(['FIRST', 'second', 'THIRD']));
      if (op === 'unstage') repo.add('b.txt');
      return repo;
    };

    const staged = prepare('stage');
    runOp(staged, 'stage', 'b.txt', first);
    expectBytes(staged.indexBlob('b.txt'), bom(['FIRST', 'second', 'third']));

    const unstaged = prepare('unstage');
    runOp(unstaged, 'unstage', 'b.txt', first);
    expectBytes(unstaged.indexBlob('b.txt'), bom(['first', 'second', 'THIRD']));

    const discarded = prepare('discard');
    runOp(discarded, 'discard', 'b.txt', first);
    expectBytes(discarded.readFile('b.txt'), bom(['first', 'second', 'THIRD']));
  });
});

describe('đối chứng: kiểm thử CRLF phải có thể fail', () => {
  it('patch bị bỏ "\\r" (như pipeline giải mã / tách theo Character) bị git từ chối trên index CRLF, patch đúng thì khớp từng byte', () => {
    const repo = newRepo();
    repo.writeFile('.gitattributes', 'c.txt -text\n');
    repo.writeFile('c.txt', 'a\r\nb\r\nc\r\nd\r\n');
    repo.add('.gitattributes', 'c.txt');
    repo.commit('base');
    repo.writeFile('c.txt', 'a\r\nB\r\nc\r\nd\r\n');

    const file = firstDiff(repo, 'unstaged', 'c.txt');
    const good = makePatch(
      file,
      selectLines(file, () => true),
      false,
    )!;
    const lossy = utf8(decodeUtf8Lossy(good).replaceAll('\r\n', '\n'));
    expect(showBytes(lossy)).not.toBe(showBytes(good));

    const rejected = repo.applyPatch(lossy, { cached: true, reverse: false });
    expect(rejected.code).not.toBe(0);
    expectBytes(repo.indexBlob('c.txt'), 'a\r\nb\r\nc\r\nd\r\n');

    expect(repo.applyPatch(good, { cached: true, reverse: false }).code).toBe(0);
    expectBytes(repo.indexBlob('c.txt'), 'a\r\nB\r\nc\r\nd\r\n');
  });
});

describe('parseDiff với output git thật', () => {
  it('file CRLF: mỗi dòng giữ "\\r", số dòng đúng (bản Swift coi "\\r\\n" là một ký tự nên không tách được dòng)', () => {
    const repo = newRepo();
    repo.writeFile('c.txt', 'a\r\nb\r\nc\r\n');
    repo.add('c.txt');
    repo.commit('base');
    repo.writeFile('c.txt', 'a\r\nB\r\nc\r\n');
    const file = firstDiff(repo, 'unstaged', 'c.txt');
    const hunk = file.hunks[0]!;
    expect(kindsOf(hunk)).toEqual(['context', 'deletion', 'addition', 'context']);
    expect(hunk.lines.map((line) => showBytes(line.text))).toEqual(['a\\r', 'b\\r', 'B\\r', 'c\\r']);
    expect([file.additions, file.deletions]).toEqual([1, 1]);
  });

  it('đổi tên có dấu cách + tiếng Việt: đường dẫn bỏ TAB cuối, similarity, hunk', () => {
    const repo = newRepo();
    const from = 'Tài liệu/ghi chú.txt'.normalize('NFC');
    const to = 'Tài liệu/ghi chú mới.txt'.normalize('NFC');
    repo.writeFile(from, 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n');
    repo.add(from);
    repo.commit('base');
    repo.git('mv', [from, to]);
    repo.writeFile(to, 'l1\nl2\nl3\nL4\nl5\nl6\nl7\nl8\n');
    repo.add(to);
    const [file] = parseDiff(
      repo.git('diff', ['--cached', '-M', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', '--', from, to])
        .stdout,
    );
    expect([file!.oldPath, file!.newPath]).toEqual([from, to]);
    expect(file!.similarity).toBeGreaterThan(50);
    expect(file!.hunks).toHaveLength(1);
  });

  it('file nhị phân → isBinary, không hỗ trợ stage từng phần', () => {
    const repo = newRepo();
    repo.writeFile('x.bin', new Uint8Array([1, 2, 0, 3, 4]));
    repo.add('x.bin');
    repo.commit('base');
    repo.writeFile('x.bin', new Uint8Array([1, 2, 0, 9, 4]));
    const file = firstDiff(repo, 'unstaged', 'x.bin');
    expect(file.isBinary).toBe(true);
    expect(supportsPartialStaging(file)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')(
    'tên file có TAB và dấu nháy kép: git đặt trong ngoặc kép, parse + dựng patch vẫn đúng',
    () => {
      const repo = newRepo();
      const name = 'we"ird\tname.txt';
      repo.writeFile(name, 'a\nb\nc\nd\ne\n');
      repo.add(name);
      repo.commit('base');
      repo.writeFile(name, 'a\nB\nc\nd\nE\n');
      const file = firstDiff(repo, 'unstaged', name);
      expect([file.oldPath, file.newPath]).toEqual([name, name]);
      runOp(repo, 'stage', name, textIs('b', 'B'));
      expectBytes(repo.indexBlob(name), 'a\nB\nc\nd\ne\n');
    },
  );
});
