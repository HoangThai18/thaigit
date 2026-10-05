import { describe, expect, it } from 'vitest';
import {
  type ConflictChoice,
  type ConflictFile,
  type ConflictResolution,
  conflictResolutions,
  parseConflictFile,
  previewConflicts,
  resolveConflicts,
  toggleConflictLine,
} from '../src/diff/index.ts';
import { latin1, showBytes, utf8 } from './helpers/git-cli.ts';

const BOM = [0xef, 0xbb, 0xbf];
const join = (...parts: (Uint8Array | number[] | string)[]): Uint8Array =>
  new Uint8Array(parts.flatMap((part) => (typeof part === 'string' ? [...utf8(part)] : [...part])));

function parse(bytes: Uint8Array | string): ConflictFile {
  const result = parseConflictFile(typeof bytes === 'string' ? utf8(bytes) : bytes);
  if (!result.ok) throw new Error(`không parse được: ${result.reason}`);
  return result.file;
}

function resolve(file: ConflictFile, choices: [number, ConflictResolution][]): string | null {
  const bytes = resolveConflicts(file, new Map(choices));
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

describe('ConflictFile (port DiffTests.swift)', () => {
  const text = [
    'header',
    '<<<<<<< HEAD',
    'ours 1',
    'ours 2',
    '||||||| base',
    'base',
    '=======',
    'theirs',
    '>>>>>>> feature/x',
    'middle',
    '<<<<<<< HEAD',
    '=======',
    'added by them',
    '>>>>>>> feature/x',
    'footer',
    '',
  ].join('\n');

  it('parsesAndResolvesConflictBlocks', () => {
    const file = parse(text);
    expect(file.blocks).toHaveLength(2);
    const [first, second] = file.blocks;
    expect([first!.oursLabel, first!.theirsLabel, first!.baseLabel]).toEqual(['HEAD', 'feature/x', 'base']);
    expect(first!.ours).toEqual(['ours 1', 'ours 2']);
    expect(first!.base).toEqual(['base']);
    expect(first!.theirs).toEqual(['theirs']);
    expect(second!.ours).toEqual([]);
    expect(second!.base).toBeNull();
    expect(second!.baseLabel).toBeNull();
    expect(resolve(file, [[0, 'ours']])).toBeNull();
    expect(
      resolve(file, [
        [0, 'theirsThenOurs'],
        [1, 'theirs'],
      ]),
    ).toBe('header\ntheirs\nours 1\nours 2\nmiddle\nadded by them\nfooter\n');
  });

  it('preservesCRLFWhenResolving', () => {
    const file = parse('a\r\n<<<<<<< HEAD\r\nx\r\n=======\r\ny\r\n>>>>>>> b\r\nz');
    expect(file.lineEnding).toBe('crlf');
    expect(file.endsWithNewline).toBe(false);
    expect(resolve(file, [[0, 'oursThenTheirs']])).toBe('a\r\nx\r\ny\r\nz');
  });

  it('ignoresIncompleteMarkers', () => {
    const file = parse('<<<<<<< not a conflict\njust text\n');
    expect(file.blocks).toHaveLength(0);
    expect(resolve(file, [])).toBe('<<<<<<< not a conflict\njust text\n');
  });
});

describe('parseConflictFile: cấu trúc khối', () => {
  it('đủ 6 cách giải', () => {
    const file = parse('a\n<<<<<<< H\no1\no2\n||||||| B\nb1\n=======\nt1\n>>>>>>> T\nz\n');
    const expected: Record<ConflictResolution, string> = {
      ours: 'a\no1\no2\nz\n',
      theirs: 'a\nt1\nz\n',
      oursThenTheirs: 'a\no1\no2\nt1\nz\n',
      theirsThenOurs: 'a\nt1\no1\no2\nz\n',
      base: 'a\nb1\nz\n',
      neither: 'a\nz\n',
    };
    expect(conflictResolutions).toEqual(Object.keys(expected));
    for (const choice of conflictResolutions)
      expect(resolve(file, [[0, choice]]), choice).toBe(expected[choice]);
  });

  it('chọn base khi khối không có base → rỗng (như Swift)', () => {
    const file = parse('<<<<<<< H\no\n=======\nt\n>>>>>>> T\n');
    expect(resolve(file, [[0, 'base']])).toBe('');
  });

  it('nhãn: rỗng, chỉ có dấu cách; 8 ký tự hoặc dính chữ không phải dấu', () => {
    const file = parse('<<<<<<<\no\n======= \nt\n>>>>>>>\n');
    expect(file.blocks).toHaveLength(1);
    expect([file.blocks[0]!.oursLabel, file.blocks[0]!.theirsLabel]).toEqual(['', '']);
    expect(parse('<<<<<<<< x\no\n=======\nt\n>>>>>>>> y\n').blocks).toHaveLength(0);
    expect(parse('<<<<<<<x\no\n=======\nt\n>>>>>>>y\n').blocks).toHaveLength(0);
    expect(parse('<<<<<< x\no\n=======\nt\n>>>>>>> y\n').blocks).toHaveLength(0);
  });

  it('nhãn có dấu cách và ký tự Unicode', () => {
    const file = parse('<<<<<<< HEAD (nhánh chính)\no\n=======\nt\n>>>>>>> feature/tiếng-việt abc\n');
    expect(file.blocks[0]!.oursLabel).toBe('HEAD (nhánh chính)');
    expect(file.blocks[0]!.theirsLabel).toBe('feature/tiếng-việt abc');
  });

  it('khối lồng nhau: <<<<<<< ngoài thành văn bản thường, khối trong vẫn nhận', () => {
    const file = parse('<<<<<<< A\nx\n<<<<<<< B\ny\n=======\nz\n>>>>>>> C\nend\n');
    expect(file.blocks).toHaveLength(1);
    expect(file.blocks[0]!.oursLabel).toBe('B');
    expect(file.segments[0]).toMatchObject({ kind: 'common', lines: ['<<<<<<< A', 'x'] });
    expect(resolve(file, [[0, 'ours']])).toBe('<<<<<<< A\nx\ny\nend\n');
  });

  it('">>>>>>>" trước "=======" và "=======" trong phần theirs là nội dung', () => {
    const file = parse('<<<<<<< a\none\n>>>>>>> lạc\n=======\ntwo\n=======\n>>>>>>> c\n');
    const block = file.blocks[0]!;
    expect(block.ours).toEqual(['one', '>>>>>>> lạc']);
    expect(block.theirs).toEqual(['two', '=======']);
    expect(block.theirsLabel).toBe('c');
  });

  it('"=======" và "|||||||" lẻ ngoài khối là văn bản thường (vd. tiêu đề markdown)', () => {
    const file = parse('Tiêu đề\n=======\nnội dung\n||||||| lạ\n');
    expect(file.blocks).toHaveLength(0);
    expect(resolve(file, [])).toBe('Tiêu đề\n=======\nnội dung\n||||||| lạ\n');
  });

  it('khối thiếu dấu đóng: văn bản thường', () => {
    const file = parse('<<<<<<< a\no\n=======\nt\n');
    expect(file.blocks).toHaveLength(0);
  });

  it('ba khối liên tiếp, id tăng dần; khối ở đầu và cuối file', () => {
    const file = parse(
      '<<<<<<< a\n1\n=======\n2\n>>>>>>> b\n<<<<<<< a\n3\n=======\n4\n>>>>>>> b\nmid\n<<<<<<< a\n5\n=======\n6\n>>>>>>> b\n',
    );
    expect(file.blocks.map((block) => block.id)).toEqual([0, 1, 2]);
    expect(file.segments.map((segment) => segment.kind)).toEqual([
      'conflict',
      'conflict',
      'common',
      'conflict',
    ]);
    expect(
      resolve(file, [
        [0, 'theirs'],
        [1, 'ours'],
        [2, 'neither'],
      ]),
    ).toBe('2\n3\nmid\n');
  });
});

describe('resolveConflicts: giữ đúng từng byte ngoài vùng xung đột', () => {
  it('file lẫn CRLF/LF: mỗi dòng giữ ký tự xuống dòng riêng của nó', () => {
    const original = 'a\n<<<<<<< H\r\nx\r\n=======\ny\n>>>>>>> t\r\nz\r\n';
    const file = parse(original);
    expect(file.lineEnding).toBe('mixed');
    expect(resolve(file, [[0, 'oursThenTheirs']])).toBe('a\nx\r\ny\nz\r\n');
    expect(resolve(file, [[0, 'theirsThenOurs']])).toBe('a\ny\nx\r\nz\r\n');
  });

  it('BOM UTF-8 giữ nguyên khi khối xung đột nằm ngay dòng đầu', () => {
    const bytes = join(BOM, '<<<<<<< H\r\nx\r\n=======\r\ny\r\n>>>>>>> t\r\nz\r\n');
    const file = parse(bytes);
    expect(file.hasBom).toBe(true);
    expect(file.blocks).toHaveLength(1);
    expect(showBytes(resolveConflicts(file, new Map([[0, 'theirs']]))!)).toBe(
      '\\xef\\xbb\\xbfy\\r\\n\nz\\r\\n\n',
    );
  });

  it('BOM không lọt vào chữ hiển thị của dòng đầu; file chỉ có BOM hoặc rỗng không có đoạn nào', () => {
    const file = parse(join(BOM, 'header\n<<<<<<< H\no\n=======\nt\n>>>>>>> T\n'));
    expect(file.segments[0]).toMatchObject({ kind: 'common', lines: ['header'] });
    expect(parse(join(BOM)).segments).toEqual([]);
    expect(parse('').segments).toEqual([]);
    expect(resolveConflicts(parse(join(BOM)), new Map())).toEqual(new Uint8Array(BOM));
    expect(resolveConflicts(parse(''), new Map())).toEqual(new Uint8Array());
  });

  it('dòng cuối ">>>>>>>" không có xuống dòng: kết quả cũng không có xuống dòng cuối', () => {
    const file = parse('x\n<<<<<<< a\no\n=======\nt\n>>>>>>> b');
    expect(file.endsWithNewline).toBe(false);
    expect(resolve(file, [[0, 'ours']])).toBe('x\no');
    expect(resolve(file, [[0, 'oursThenTheirs']])).toBe('x\no\nt');
    // "Pick neither side": the leading common part stays verbatim (no byte outside the region is touched).
    expect(resolve(file, [[0, 'neither']])).toBe('x\n');
    const crlf = parse('x\r\n<<<<<<< a\r\no\r\n=======\r\nt\r\n>>>>>>> b');
    expect(resolve(crlf, [[0, 'theirs']])).toBe('x\r\nt');
  });

  it('dòng cuối ">>>>>>>" có xuống dòng: kết quả giữ xuống dòng cuối', () => {
    const file = parse('x\n<<<<<<< a\no\n=======\nt\n>>>>>>> b\n');
    expect(resolve(file, [[0, 'ours']])).toBe('x\no\n');
    expect(resolve(file, [[0, 'neither']])).toBe('x\n');
  });

  it('phần chung không có xuống dòng cuối được giữ nguyên', () => {
    const file = parse('<<<<<<< a\no\n=======\nt\n>>>>>>> b\ncuối không xuống dòng');
    expect(resolve(file, [[0, 'ours']])).toBe('o\ncuối không xuống dòng');
  });

  it('kết quả là mảng mới, không đụng vào buffer gốc', () => {
    const original = utf8('<<<<<<< a\no\n=======\nt\n>>>>>>> b\n');
    const snapshot = original.slice();
    const file = parse(original);
    const resolved = resolveConflicts(file, new Map([[0, 'ours']]))!;
    resolved.fill(0);
    expect(original).toEqual(snapshot);
  });

  it('các đoạn tính cả BOM phủ kín file: tổng độ dài khớp', () => {
    const bytes = join(BOM, 'a\n<<<<<<< H\r\no\r\n||||||| B\nb\n=======\nt\n>>>>>>> T\r\nz');
    const file = parse(bytes);
    let covered = file.hasBom ? 3 : 0;
    for (const segment of file.segments) {
      covered +=
        segment.kind === 'common'
          ? segment.range.end - segment.range.start
          : segment.block.region.end - segment.block.region.start;
    }
    expect(covered).toBe(bytes.length);
  });
});

describe('parseConflictFile: file không phải UTF-8 bị từ chối', () => {
  const rejected: [string, Uint8Array][] = [
    ['CP1252 (é = 0xE9)', latin1('caf\xe9\n<<<<<<< a\nx\n=======\ny\n>>>>>>> b\n')],
    ['CP1258 (Việt = V i ê 0xF2 t)', latin1('Vi\xea\xf2t\n<<<<<<< a\nx\n=======\ny\n>>>>>>> b\n')],
    ['UTF-16 LE có BOM', new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x0a, 0x00])],
    ['đa byte bị cắt cuối file', new Uint8Array([0x61, 0xe1, 0xbb])],
    ['overlong (C0 80)', new Uint8Array([0x61, 0xc0, 0x80])],
    ['surrogate mã hoá (ED A0 80)', new Uint8Array([0xed, 0xa0, 0x80])],
    ['lỗi nằm trong khối xung đột', join('<<<<<<< a\n', [0xe9], '\n=======\ny\n>>>>>>> b\n')],
  ];
  for (const [name, bytes] of rejected) {
    it(name, () => {
      const copy = bytes.slice();
      expect(parseConflictFile(bytes)).toEqual({ ok: false, reason: 'not-utf8' });
      expect(bytes).toEqual(copy);
    });
  }

  it('UTF-8 hợp lệ (tiếng Việt, emoji, BOM) được nhận', () => {
    const file = parse(join(BOM, 'Việt Nam 🇻🇳\n<<<<<<< a\nđầu\n=======\ncuối\n>>>>>>> b\n'));
    expect(file.blocks[0]!.ours).toEqual(['đầu']);
    expect(file.segments[0]).toMatchObject({ lines: ['Việt Nam 🇻🇳'] });
  });
});

// Randomised tests (fixed PRNG, so they are reproducible): build a file from known chunks and compute the expectation
// independently of the parser by concatenating exactly those chunks.
describe('resolveConflicts: ngẫu nhiên — chỉ vùng xung đột bị thay', () => {
  function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const WORDS = [
    'alpha',
    'đường dẫn',
    'Việt Nam',
    '=== không phải dấu',
    'tab\there',
    'x'.repeat(40),
    '',
    '  khoảng trắng  ',
  ];

  for (let seed = 1; seed <= 40; seed++) {
    it(`seed ${seed}`, () => {
      const random = mulberry32(seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
      const eol = () => pick(['\n', '\r\n']);
      const chunk = (count: number): string => {
        let out = '';
        for (let i = 0; i < count; i++) out += `${pick(WORDS)}${eol()}`;
        return out;
      };

      let input = random() < 0.4 ? '﻿' : '';
      const bom = input.length > 0;
      let expected = input;
      const choices = new Map<number, ConflictResolution>();
      const blockCount = 1 + Math.floor(random() * 4);
      for (let id = 0; id < blockCount; id++) {
        const common = chunk(Math.floor(random() * 3));
        const ours = chunk(Math.floor(random() * 3));
        const theirs = chunk(Math.floor(random() * 3));
        const base = random() < 0.4 ? chunk(Math.floor(random() * 3)) : null;
        const head = `<<<<<<< ours${eol()}`;
        input += `${common}${head}${ours}${base === null ? '' : `||||||| base${eol()}${base}`}=======${eol()}${theirs}>>>>>>> theirs${eol()}`;
        const choice = pick(conflictResolutions);
        choices.set(id, choice);
        const sides: Record<ConflictResolution, string> = {
          ours,
          theirs,
          oursThenTheirs: ours + theirs,
          theirsThenOurs: theirs + ours,
          base: base ?? '',
          neither: '',
        };
        expected += common + sides[choice];
      }
      const tail = chunk(Math.floor(random() * 3));
      input += tail;
      expected += tail;

      const file = parse(input);
      expect(file.hasBom).toBe(bom);
      expect(file.blocks).toHaveLength(blockCount);
      const actual = resolveConflicts(file, choices)!;
      expect(showBytes(actual)).toBe(showBytes(utf8(expected)));
    });
  }
});

describe('hiệu năng (chặn hồi quy O(n²); ngưỡng rất rộng)', () => {
  it('parse + giải file 60.000 dòng với 500 khối xung đột dưới 2 giây', () => {
    const rows: string[] = [];
    for (let block = 0; block < 500; block++) {
      for (let i = 0; i < 100; i++) rows.push(`dòng chung ${block}.${i}`);
      rows.push('<<<<<<< HEAD', `của ta ${block}`, '=======', `của họ ${block}`, '>>>>>>> feature');
    }
    const bytes = utf8(`${rows.join('\r\n')}\r\n`);
    const start = performance.now();
    const file = parse(bytes);
    expect(file.blocks).toHaveLength(500);
    const choices = new Map<number, ConflictResolution>(
      file.blocks.map((block) => [block.id, 'oursThenTheirs']),
    );
    const resolved = resolveConflicts(file, choices)!;
    expect(resolved.length).toBeLessThan(bytes.length);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe('chọn từng dòng và xem trước (như GitKraken)', () => {
  const text =
    'top\n<<<<<<< HEAD\nA1\nA2\nA3\n=======\nB1\nB2\n>>>>>>> feat\nbottom\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> feat\nend';
  const decode = (bytes: Uint8Array | null) => (bytes === null ? null : new TextDecoder().decode(bytes));

  it('giữ thứ tự trong file (Current trước Incoming) dù tick theo thứ tự nào', () => {
    const file = parse(text);
    const first = file.blocks[0]!;
    let pick = toggleConflictLine(undefined, first, 'theirs', 1);
    pick = toggleConflictLine(pick, first, 'ours', 2);
    pick = toggleConflictLine(pick, first, 'ours', 0);
    expect([...pick.ours].sort()).toEqual([0, 2]);
    expect([...pick.theirs]).toEqual([1]);

    // Segment 2 still unselected: the preview keeps the conflict markers and cannot be saved yet.
    expect(decode(previewConflicts(file, new Map([[0, pick]])))).toBe(
      'top\nA1\nA3\nB2\nbottom\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> feat\nend',
    );
    expect(resolveConflicts(file, new Map([[0, pick]]))).toBeNull();
    const second = toggleConflictLine(
      toggleConflictLine(undefined, file.blocks[1]!, 'ours', 0),
      file.blocks[1]!,
      'theirs',
      0,
    );
    expect(
      decode(
        resolveConflicts(
          file,
          new Map([
            [0, pick],
            [1, second],
          ]),
        ),
      ),
    ).toBe('top\nA1\nA3\nB2\nbottom\nx\ny\nend');
  });

  it('bỏ một dòng khỏi "Giữ Current" và bỏ hết dòng = xoá cả đoạn', () => {
    const file = parse(text);
    const fromSide = toggleConflictLine('ours', file.blocks[0]!, 'ours', 1);
    expect([...fromSide.ours].sort()).toEqual([0, 2]);
    expect([...fromSide.theirs]).toEqual([]);
    const empty = { kind: 'lines' as const, ours: new Set<number>(), theirs: new Set<number>() };
    expect(
      decode(
        resolveConflicts(
          file,
          new Map<number, ConflictChoice>([
            [0, empty],
            [1, 'neither'],
          ]),
        ),
      ),
    ).toBe('top\nbottom\nend');
  });
});
