// Giải conflict theo byte với git THẬT: tạo merge conflict trong repo tạm rồi parse/giải/lưu bằng `ConflictFile`.
// Quy tắc: file không phải UTF-8 bị từ chối và không đổi byte nào; BOM + kiểu xuống dòng giữ nguyên; chỉ vùng khối
// xung đột bị thay.

import { afterEach, describe, expect, it } from 'vitest';
import {
  type ConflictFile,
  type ConflictResolution,
  parseConflictFile,
  resolveConflicts,
} from '../src/diff/index.ts';
import { TempRepo, latin1, showBytes, utf8 } from './helpers/git-cli.ts';

const repos: TempRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

interface ConflictSetup {
  readonly base: Uint8Array | string;
  readonly ours: Uint8Array | string;
  readonly theirs: Uint8Array | string;
  readonly path?: string;
  readonly conflictStyle?: 'merge' | 'diff3';
}

/** Hai nhánh cùng sửa một chỗ → `git merge` dừng với xung đột; trả repo đang ở giữa merge. */
function makeConflict(setup: ConflictSetup): TempRepo {
  const path = setup.path ?? 'f.txt';
  const repo = TempRepo.create({ autocrlf: 'false' });
  repos.push(repo);
  if (setup.conflictStyle) repo.appendConfig(`[merge]\n\tconflictStyle = ${setup.conflictStyle}\n`);
  repo.writeFile(path, setup.base);
  repo.add(path);
  repo.commit('base');
  repo.git('checkout', ['-q', '-b', 'feature']);
  repo.writeFile(path, setup.theirs);
  repo.add(path);
  repo.commit('theirs');
  repo.git('checkout', ['-q', 'main']);
  repo.writeFile(path, setup.ours);
  repo.add(path);
  repo.commit('ours');
  const merge = repo.git('merge', ['--no-edit', 'feature'], { allowFailure: true });
  expect(merge.code, merge.stderr).toBe(1);
  return repo;
}

const unmergedEntries = (repo: TempRepo): string =>
  new TextDecoder().decode(repo.git('ls-files', ['-u']).stdout).replace(/[0-9a-f]{40}/g, '<sha>');

function parseOk(bytes: Uint8Array): ConflictFile {
  const result = parseConflictFile(bytes);
  if (!result.ok) throw new Error(`bị từ chối: ${result.reason}`);
  return result.file;
}

describe('file không phải UTF-8: từ chối, không đổi byte nào', () => {
  const cases: [string, string, string, string][] = [
    [
      'CP1252',
      'caf\xe9 un\nligne deux\nfin \xe0 la\n',
      'caf\xe9 un\nligne deux \xe0 nous\nfin \xe0 la\n',
      'caf\xe9 un\nligne deux \xe0 eux\nfin \xe0 la\n',
    ],
    [
      'CP1258',
      'Xin ch\xe0o\nVi\xea\xf2t Nam\nH\xe0 N\xf2i\n',
      'Xin ch\xe0o\nVi\xea\xf2t Nam c\xf4ng\nH\xe0 N\xf2i\n',
      'Xin ch\xe0o\nVi\xea\xf2t Nam t\xe2y\nH\xe0 N\xf2i\n',
    ],
  ];
  for (const [name, base, ours, theirs] of cases) {
    it(`${name}: parse trả "not-utf8"; worktree và index (3 mức xung đột) không đổi byte nào`, () => {
      const repo = makeConflict({ base: latin1(base), ours: latin1(ours), theirs: latin1(theirs) });
      const before = repo.readFile('f.txt');
      expect(new TextDecoder().decode(before)).toContain('<<<<<<<');
      const indexBefore = unmergedEntries(repo);
      expect(indexBefore.split('\n').filter(Boolean)).toHaveLength(3);

      expect(parseConflictFile(before)).toEqual({ ok: false, reason: 'not-utf8' });

      expect(showBytes(repo.readFile('f.txt'))).toBe(showBytes(before));
      expect(unmergedEntries(repo)).toBe(indexBefore);
      expect(new TextDecoder().decode(repo.git('status', ['--porcelain']).stdout)).toBe('UU f.txt\n');
    });
  }

  it('đối chứng: đường giải mã lỏng rồi ghi lại sẽ làm hỏng byte (đây là lý do phải từ chối)', () => {
    const repo = makeConflict({
      base: latin1('caf\xe9\nx\n'),
      ours: latin1('caf\xe9\nA\n'),
      theirs: latin1('caf\xe9\nB\n'),
    });
    const bytes = repo.readFile('f.txt');
    const roundTrip = new TextEncoder().encode(new TextDecoder().decode(bytes));
    expect(showBytes(roundTrip)).not.toBe(showBytes(bytes));
  });
});

describe('BOM UTF-8 + CRLF', () => {
  const BOM = 'ï»¿';
  const crlf = (...lines: string[]) => latin1(BOM + lines.map((line) => `${line}\r\n`).join(''));

  const resolveTo = (repo: TempRepo, choice: ConflictResolution): Uint8Array => {
    const file = parseOk(repo.readFile('f.txt'));
    expect(file.hasBom).toBe(true);
    expect(file.blocks).toHaveLength(1);
    const resolved = resolveConflicts(file, new Map([[0, choice]]));
    if (resolved === null) throw new Error('chưa giải hết');
    return resolved;
  };

  it('giải "cả hai", lưu, add và commit: blob trong HEAD đúng từng byte (BOM + CRLF còn nguyên)', () => {
    const repo = makeConflict({
      base: crlf('one', 'two', 'three'),
      ours: crlf('one', 'OURS', 'three'),
      theirs: crlf('one', 'THEIRS', 'three'),
    });
    const resolved = resolveTo(repo, 'oursThenTheirs');
    expect(showBytes(resolved)).toBe(showBytes(crlf('one', 'OURS', 'THEIRS', 'three')));

    repo.writeFile('f.txt', resolved);
    repo.add('f.txt');
    repo.git('commit', ['--no-edit', '--no-verify', '-q']);
    expect(showBytes(repo.headBlob('f.txt'))).toBe(showBytes(crlf('one', 'OURS', 'THEIRS', 'three')));
    expect([...repo.headBlob('f.txt').slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('mọi cách giải đều giữ BOM và không đụng các dòng ngoài khối', () => {
    const expected: Record<ConflictResolution, string[]> = {
      ours: ['one', 'OURS', 'three'],
      theirs: ['one', 'THEIRS', 'three'],
      oursThenTheirs: ['one', 'OURS', 'THEIRS', 'three'],
      theirsThenOurs: ['one', 'THEIRS', 'OURS', 'three'],
      base: ['one', 'three'], // merge mặc định không có phần base → rỗng
      neither: ['one', 'three'],
    };
    for (const [choice, lines] of Object.entries(expected) as [ConflictResolution, string[]][]) {
      const repo = makeConflict({
        base: crlf('one', 'two', 'three'),
        ours: crlf('one', 'OURS', 'three'),
        theirs: crlf('one', 'THEIRS', 'three'),
      });
      expect(showBytes(resolveTo(repo, choice)), choice).toBe(showBytes(crlf(...lines)));
    }
  });

  it('dòng đánh dấu của git ở file CRLF cũng kết thúc bằng "\\r\\n" và được nhận đúng nhãn', () => {
    const repo = makeConflict({
      base: crlf('one', 'two', 'three'),
      ours: crlf('one', 'OURS', 'three'),
      theirs: crlf('one', 'THEIRS', 'three'),
    });
    const file = parseOk(repo.readFile('f.txt'));
    expect(file.lineEnding === 'crlf' || file.lineEnding === 'mixed').toBe(true);
    expect([file.blocks[0]!.oursLabel, file.blocks[0]!.theirsLabel]).toEqual(['HEAD', 'feature']);
    expect(file.blocks[0]!.ours).toEqual(['OURS']);
    expect(file.blocks[0]!.theirs).toEqual(['THEIRS']);
  });
});

describe('merge.conflictStyle=diff3 và file UTF-8 tiếng Việt', () => {
  it('nhận phần base, giải bằng base / ours / theirs', () => {
    const base = utf8('Tiêu đề\ndòng gốc\nChân trang\n');
    const ours = utf8('Tiêu đề\ndòng của chúng tôi\nChân trang\n');
    const theirs = utf8('Tiêu đề\ndòng của họ\nChân trang\n');
    const repo = makeConflict({ base, ours, theirs, conflictStyle: 'diff3' });
    const file = parseOk(repo.readFile('f.txt'));
    expect(file.blocks).toHaveLength(1);
    const block = file.blocks[0]!;
    expect(block.base).toEqual(['dòng gốc']);
    expect([block.ours, block.theirs]).toEqual([['dòng của chúng tôi'], ['dòng của họ']]);
    expect(block.baseLabel).not.toBeNull();

    const text = (choice: ConflictResolution) =>
      new TextDecoder().decode(resolveConflicts(file, new Map([[0, choice]]))!);
    expect(text('base')).toBe('Tiêu đề\ndòng gốc\nChân trang\n');
    expect(text('ours')).toBe('Tiêu đề\ndòng của chúng tôi\nChân trang\n');
    expect(text('theirsThenOurs')).toBe('Tiêu đề\ndòng của họ\ndòng của chúng tôi\nChân trang\n');
  });

  it('nhiều khối xung đột trong một file: giải riêng từng khối', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `dòng ${i + 1}`);
    const edit = (prefix: string) =>
      lines.map((line, i) => (i === 2 || i === 16 ? `${prefix} ${line}` : line)).join('\n') + '\n';
    const repo = makeConflict({
      base: utf8(`${lines.join('\n')}\n`),
      ours: utf8(edit('ours')),
      theirs: utf8(edit('theirs')),
    });
    const file = parseOk(repo.readFile('f.txt'));
    expect(file.blocks).toHaveLength(2);
    const resolved = new TextDecoder().decode(
      resolveConflicts(
        file,
        new Map<number, ConflictResolution>([
          [0, 'theirs'],
          [1, 'ours'],
        ]),
      )!,
    );
    expect(resolved.split('\n')[2]).toBe('theirs dòng 3');
    expect(resolved.split('\n')[16]).toBe('ours dòng 17');
    expect(resolved.split('\n')).toHaveLength(21);
  });
});

describe('xung đột không có dấu (sửa/xoá)', () => {
  it('file còn lại không có <<<<<<<: parse thành công với 0 khối, giải rỗng trả đúng byte gốc', () => {
    const repo = TempRepo.create({ autocrlf: 'false' });
    repos.push(repo);
    repo.writeFile('f.txt', 'a\nb\nc\n');
    repo.add('f.txt');
    repo.commit('base');
    repo.git('checkout', ['-q', '-b', 'feature']);
    repo.git('rm', ['-q', 'f.txt']);
    repo.commit('xoá');
    repo.git('checkout', ['-q', 'main']);
    repo.writeFile('f.txt', 'a\nB\nc\n');
    repo.add('f.txt');
    repo.commit('sửa');
    expect(repo.git('merge', ['--no-edit', 'feature'], { allowFailure: true }).code).toBe(1);
    const bytes = repo.readFile('f.txt');
    const file = parseOk(bytes);
    expect(file.blocks).toHaveLength(0);
    expect(showBytes(resolveConflicts(file, new Map())!)).toBe(showBytes(bytes));
  });
});
