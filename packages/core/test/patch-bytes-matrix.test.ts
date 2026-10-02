// Ma trận CRLF (FM8/AD9) với git THẬT trong repo tạm cô lập, so sánh BYTE của blob index (`git cat-file blob :path`)
// và file working tree:
//   {core.autocrlf true | input | false} × {index LF | CRLF có `-text` | CRLF cũ (không thuộc tính) | lẫn LF/CRLF}
//   × {file kết thúc bằng newline | không có newline cuối} × {chọn dòng 2 | chọn dòng cuối} × {stage | unstage | huỷ}
// Kỳ vọng tính từ MÔ HÌNH ĐỘC LẬP (chỉ dòng được chọn đổi, mọi byte khác giữ nguyên), không gọi code đang test —
// nên test có thể fail. Một số ô có thêm đáp án vàng viết thẳng từng byte. Nhóm cuối ghi lại hành vi của git khi
// kiểu xuống dòng của working tree khác với cấu hình (git apply tự chuẩn hoá cả file khi huỷ dòng).

import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { changeLineIndices, isChangeLine, makePatch, parseDiff } from '../src/diff/index.ts';
import { decodeUtf8Lossy } from '../src/support/text.ts';
import { type AutoCrlf, TempRepo, latin1, showBytes } from './helpers/git-cli.ts';

const repos: TempRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

type Eol = '' | '\n' | '\r\n';
interface Line {
  readonly text: string;
  readonly eol: Eol;
}
type IndexKind = 'lf' | 'crlf-text-off' | 'crlf-legacy' | 'mixed';
type Op = 'stage' | 'unstage' | 'discard';

const toBytes = (lines: readonly Line[]): Uint8Array =>
  latin1(lines.map((line) => line.text + line.eol).join(''));

function parseLines(bytes: Uint8Array): Line[] {
  const text = String.fromCharCode(...bytes);
  const lines: Line[] = [];
  let start = 0;
  while (start < text.length) {
    const lf = text.indexOf('\n', start);
    if (lf === -1) {
      lines.push({ text: text.slice(start), eol: '' });
      break;
    }
    const crlf = lf > start && text[lf - 1] === '\r';
    lines.push({ text: text.slice(start, crlf ? lf - 1 : lf), eol: crlf ? '\r\n' : '\n' });
    start = lf + 1;
  }
  return lines;
}

/** Nội dung blob trong index lúc đầu. Dòng cuối có/không có newline theo `finalEol`. */
function baseLines(kind: IndexKind, finalEol: boolean): Line[] {
  const eolOf = (i: number): Eol =>
    kind === 'lf' ? '\n' : kind === 'mixed' ? (i % 2 === 0 ? '\n' : '\r\n') : '\r\n';
  return ['L1', 'L2', 'L3', 'L4', 'L5'].map((text, i) => ({
    text,
    eol: i === 4 && !finalEol ? '' : eolOf(i),
  }));
}

/** Bộ lọc "clean" của git có chạy ở diff/add không: autocrlf=true|input, file không có CR trong index, không `-text`. */
const normalizes = (autocrlf: AutoCrlf, kind: IndexKind): boolean => autocrlf !== 'false' && kind === 'lf';

/** Dòng như `git diff` hiển thị: CRLF → LF khi bộ lọc clean chạy. */
const asDiffed = (line: Line, normalize: boolean): Line =>
  normalize && line.eol === '\r\n' ? { text: line.text, eol: '\n' } : line;

/**
 * Repo mẫu cho mỗi (autocrlf, loại index, newline cuối): commit nội dung thô (autocrlf=false), chuyển cấu hình rồi
 * checkout lại để worktree đúng như git sẽ tạo. Mỗi ô của ma trận sao chép repo mẫu (rẻ hơn dựng lại bằng 5 lệnh git).
 */
const templates = new Map<string, { repo: TempRepo; base: Line[]; wt0: Line[] }>();
afterAll(() => {
  for (const template of templates.values()) template.repo.cleanup();
  templates.clear();
});

function template(autocrlf: AutoCrlf, kind: IndexKind, finalEol: boolean) {
  const key = `${autocrlf}|${kind}|${finalEol}`;
  let cached = templates.get(key);
  if (!cached) {
    const repo = TempRepo.create();
    repo.setAutocrlf('false');
    if (kind === 'crlf-text-off') {
      repo.writeFile('.gitattributes', 'data.txt -text\n');
      repo.add('.gitattributes');
    }
    const base = baseLines(kind, finalEol);
    repo.writeFile('data.txt', toBytes(base));
    repo.add('data.txt');
    repo.commit('base');
    repo.setAutocrlf(autocrlf);
    repo.removeFile('data.txt');
    repo.git('checkout', ['--', 'data.txt']);
    cached = { repo, base, wt0: parseLines(repo.readFile('data.txt')) };
    templates.set(key, cached);
  }
  return cached;
}

function setup(
  autocrlf: AutoCrlf,
  kind: IndexKind,
  finalEol: boolean,
  editedOverride?: (wt0: Line[]) => Line[],
) {
  const { repo: source, base, wt0 } = template(autocrlf, kind, finalEol);
  const repo = source.fork();
  repos.push(repo);
  // Sửa dòng 2 và dòng 5 như một trình soạn thảo: giữ ký tự xuống dòng của từng dòng.
  const edited = editedOverride
    ? editedOverride(wt0)
    : wt0.map((line, i) => (i === 1 ? { ...line, text: 'A2' } : i === 4 ? { ...line, text: 'A5' } : line));
  repo.writeFile('data.txt', toBytes(edited));
  return { repo, base, wt0, edited };
}

/** Chọn cặp xoá+thêm của một dòng (theo chữ L2/A2 hoặc L5/A5; có thể kèm "\r"). */
function pickLine(which: 'second' | 'last') {
  const tokens = which === 'second' ? ['L2', 'A2'] : ['L5', 'A5'];
  return (text: string): boolean => tokens.some((token) => text === token || text === `${token}\r`);
}

function applySelected(repo: TempRepo, op: Op, accept: (text: string) => boolean): void {
  const [file] = parseDiff(repo.diffBytes(op === 'unstage' ? 'staged' : 'unstaged', 'data.txt'));
  if (!file) throw new Error('không có diff');
  const selection = new Map<number, Set<number>>();
  for (const hunk of file.hunks) {
    const indices = hunk.lines.flatMap((line, index) =>
      isChangeLine(line) && accept(decodeUtf8Lossy(line.text)) ? [index] : [],
    );
    if (indices.length > 0) selection.set(hunk.id, new Set(indices));
  }
  const patch = makePatch(file, selection, op !== 'stage');
  if (patch === null) throw new Error('không dựng được patch');
  const result = repo.applyPatch(patch, { cached: op !== 'discard', reverse: op !== 'stage' });
  if (result.code !== 0) throw new Error(`git apply thất bại: ${result.stderr}\n${showBytes(patch)}`);
}

const expectBytes = (actual: Uint8Array, expected: Uint8Array | string): void =>
  expect(showBytes(actual)).toBe(showBytes(typeof expected === 'string' ? latin1(expected) : expected));

const AUTOCRLF: AutoCrlf[] = ['true', 'input', 'false'];
const KINDS: IndexKind[] = ['lf', 'crlf-text-off', 'crlf-legacy', 'mixed'];
const KIND_NAME: Record<IndexKind, string> = {
  lf: 'index LF',
  'crlf-text-off': 'index CRLF (.gitattributes -text)',
  'crlf-legacy': 'index CRLF cũ (không thuộc tính)',
  mixed: 'index lẫn LF/CRLF',
};

describe('ma trận CRLF × stage/unstage/huỷ dòng (từng byte, git thật)', () => {
  for (const autocrlf of AUTOCRLF) {
    for (const kind of KINDS) {
      for (const finalEol of [true, false]) {
        for (const which of ['second', 'last'] as const) {
          for (const op of ['stage', 'unstage', 'discard'] as const) {
            const label = `autocrlf=${autocrlf} | ${KIND_NAME[kind]} | ${finalEol ? 'có newline cuối' : 'KHÔNG newline cuối'} | chọn ${which === 'second' ? 'dòng 2' : 'dòng cuối'} | ${op}`;
            it(label, () => {
              const { repo, base, wt0, edited } = setup(autocrlf, kind, finalEol);
              const normalize = normalizes(autocrlf, kind);
              const position = which === 'second' ? 1 : 4;
              const wtBefore = repo.readFile('data.txt');

              if (op === 'unstage') repo.add('data.txt');
              applySelected(repo, op, pickLine(which));

              if (op === 'stage') {
                // Index: base với dòng đã chọn thay bằng dòng như git diff hiển thị; worktree không đổi.
                const expected = base.map((line, i) =>
                  i === position ? asDiffed(edited[i]!, normalize) : line,
                );
                expectBytes(repo.indexBlob('data.txt'), toBytes(expected));
                expectBytes(repo.readFile('data.txt'), wtBefore);
              } else if (op === 'unstage') {
                // Sau `git add` index = bản đã clean của worktree; bỏ stage riêng dòng đã chọn → dòng đó về như HEAD.
                const staged = edited.map((line) => asDiffed(line, normalize));
                const expected = staged.map((line, i) => (i === position ? base[i]! : line));
                expectBytes(repo.indexBlob('data.txt'), toBytes(expected));
                expectBytes(repo.readFile('data.txt'), wtBefore);
              } else {
                // Huỷ dòng đã chọn khỏi worktree: dòng đó về đúng byte lúc checkout, các dòng khác không đổi.
                const expected = edited.map((line, i) => (i === position ? wt0[i]! : line));
                expectBytes(repo.readFile('data.txt'), toBytes(expected));
                expectBytes(repo.indexBlob('data.txt'), toBytes(base));
              }
            });
          }
        }
      }
    }
  }
});

describe('đáp án vàng viết thẳng từng byte (file kết thúc bằng newline)', () => {
  // Worktree sau checkout: chỉ index LF + autocrlf=true bị git đổi sang CRLF; mọi ô còn lại giữ nguyên byte của blob.
  interface Golden {
    /** Worktree sau khi sửa dòng 2 và 5. */
    edited: string;
    /** Index sau khi stage riêng thay đổi ở dòng 2. */
    stageSecondIndex: string;
    /** Index sau khi stage hết rồi bỏ stage riêng thay đổi ở dòng 5. */
    unstageLastIndex: string;
    /** Worktree sau khi huỷ riêng thay đổi ở dòng 5. */
    discardLastWorktree: string;
  }
  const LF: Golden = {
    edited: 'L1\nA2\nL3\nL4\nA5\n',
    stageSecondIndex: 'L1\nA2\nL3\nL4\nL5\n',
    unstageLastIndex: 'L1\nA2\nL3\nL4\nL5\n',
    discardLastWorktree: 'L1\nA2\nL3\nL4\nL5\n',
  };
  const CRLF: Golden = {
    edited: 'L1\r\nA2\r\nL3\r\nL4\r\nA5\r\n',
    stageSecondIndex: 'L1\r\nA2\r\nL3\r\nL4\r\nL5\r\n',
    unstageLastIndex: 'L1\r\nA2\r\nL3\r\nL4\r\nL5\r\n',
    discardLastWorktree: 'L1\r\nA2\r\nL3\r\nL4\r\nL5\r\n',
  };
  const MIXED: Golden = {
    edited: 'L1\nA2\r\nL3\nL4\r\nA5\n',
    stageSecondIndex: 'L1\nA2\r\nL3\nL4\r\nL5\n',
    unstageLastIndex: 'L1\nA2\r\nL3\nL4\r\nL5\n',
    discardLastWorktree: 'L1\nA2\r\nL3\nL4\r\nL5\n',
  };
  // Index LF + autocrlf=true: worktree là CRLF nhưng blob trong index vẫn là LF.
  const LF_ON_WINDOWS: Golden = { ...LF, edited: CRLF.edited, discardLastWorktree: CRLF.discardLastWorktree };

  const table: [AutoCrlf, IndexKind, Golden][] = [
    ['true', 'lf', LF_ON_WINDOWS],
    ['input', 'lf', LF],
    ['false', 'lf', LF],
    ...AUTOCRLF.flatMap((autocrlf): [AutoCrlf, IndexKind, Golden][] => [
      [autocrlf, 'crlf-text-off', CRLF],
      [autocrlf, 'crlf-legacy', CRLF],
      [autocrlf, 'mixed', MIXED],
    ]),
  ];

  for (const [autocrlf, kind, golden] of table) {
    it(`autocrlf=${autocrlf} | ${KIND_NAME[kind]}`, () => {
      // stage dòng 2
      let cell = setup(autocrlf, kind, true);
      expectBytes(cell.repo.readFile('data.txt'), golden.edited);
      applySelected(cell.repo, 'stage', pickLine('second'));
      expectBytes(cell.repo.indexBlob('data.txt'), golden.stageSecondIndex);
      expectBytes(cell.repo.readFile('data.txt'), golden.edited);

      // unstage dòng cuối
      cell = setup(autocrlf, kind, true);
      cell.repo.add('data.txt');
      applySelected(cell.repo, 'unstage', pickLine('last'));
      expectBytes(cell.repo.indexBlob('data.txt'), golden.unstageLastIndex);
      expectBytes(cell.repo.readFile('data.txt'), golden.edited);

      // huỷ dòng cuối
      cell = setup(autocrlf, kind, true);
      applySelected(cell.repo, 'discard', pickLine('last'));
      expectBytes(cell.repo.readFile('data.txt'), golden.discardLastWorktree);
      expectBytes(cell.repo.indexBlob('data.txt'), toBytes(baseLines(kind, true)));
    });
  }
});

describe('đáp án vàng: file KHÔNG có newline cuối (dòng cuối "L5"/"A5" không có xuống dòng)', () => {
  it('index LF + autocrlf=true (worktree CRLF): stage dòng cuối giữ nguyên việc thiếu newline ở cả hai nơi', () => {
    const cell = setup('true', 'lf', false);
    expectBytes(cell.repo.readFile('data.txt'), 'L1\r\nA2\r\nL3\r\nL4\r\nA5');
    applySelected(cell.repo, 'stage', pickLine('last'));
    expectBytes(cell.repo.indexBlob('data.txt'), 'L1\nL2\nL3\nL4\nA5');
    expectBytes(cell.repo.readFile('data.txt'), 'L1\r\nA2\r\nL3\r\nL4\r\nA5');
  });

  it('index CRLF -text: dòng cuối không có "\\r\\n"; stage riêng dòng 2 giữ "L5" không newline', () => {
    const cell = setup('false', 'crlf-text-off', false);
    expectBytes(cell.repo.readFile('data.txt'), 'L1\r\nA2\r\nL3\r\nL4\r\nA5');
    applySelected(cell.repo, 'stage', pickLine('second'));
    expectBytes(cell.repo.indexBlob('data.txt'), 'L1\r\nA2\r\nL3\r\nL4\r\nL5');
  });

  it('index CRLF -text: huỷ riêng dòng cuối (không newline) khỏi worktree', () => {
    const cell = setup('false', 'crlf-text-off', false);
    applySelected(cell.repo, 'discard', pickLine('last'));
    expectBytes(cell.repo.readFile('data.txt'), 'L1\r\nA2\r\nL3\r\nL4\r\nL5');
  });

  it('index lẫn LF/CRLF, autocrlf=input: unstage riêng dòng 2 khi dòng cuối không có newline', () => {
    const cell = setup('input', 'mixed', false);
    cell.repo.add('data.txt');
    applySelected(cell.repo, 'unstage', pickLine('second'));
    expectBytes(cell.repo.indexBlob('data.txt'), 'L1\nL2\r\nL3\nL4\r\nA5');
  });

  it('đổi cả trạng thái newline cuối: thêm dòng mới sau dòng cuối không có newline, chỉ stage dòng mới (CRLF -text)', () => {
    const repo = TempRepo.create();
    repos.push(repo);
    repo.writeFile('.gitattributes', 'data.txt -text\n');
    repo.writeFile('data.txt', 'L1\r\nL2');
    repo.add('.gitattributes', 'data.txt');
    repo.commit('base');
    repo.writeFile('data.txt', 'L1\r\nL2\r\nL3');
    applySelected(repo, 'stage', (text) => text === 'L3');
    expectBytes(repo.indexBlob('data.txt'), 'L1\r\nL2\r\nL3');
    expect(repo.diffBytes('unstaged', 'data.txt')).toHaveLength(0);
  });
});

describe('khi kiểu xuống dòng của worktree KHÁC cấu hình — hành vi của git được ghi lại', () => {
  /** Chọn cặp xoá+thêm đầu tiên trong hunk duy nhất (đúng như cách người dùng chọn "dòng đầu bị đổi"). */
  const firstPair = (repo: TempRepo, op: Op): void => {
    const [file] = parseDiff(repo.diffBytes(op === 'unstage' ? 'staged' : 'unstaged', 'data.txt'));
    const hunk = file!.hunks[0]!;
    const indices = changeLineIndices(hunk);
    const firstDeletion = indices.find((i) => hunk.lines[i]!.kind === 'deletion')!;
    const firstAddition = indices.find((i) => hunk.lines[i]!.kind === 'addition')!;
    const patch = makePatch(
      file!,
      new Map([[hunk.id, new Set([firstDeletion, firstAddition])]]),
      op !== 'stage',
    )!;
    const result = repo.applyPatch(patch, { cached: op !== 'discard', reverse: op !== 'stage' });
    expect(result.code, result.stderr).toBe(0);
  };
  const prepare = (autocrlf: AutoCrlf, kind: IndexKind, worktree: string): TempRepo => {
    const { repo } = setup(autocrlf, kind, true, () => parseLines(latin1(worktree)));
    return repo;
  };

  it('stage/unstage chỉ đụng index nên luôn đúng dù worktree lệch: index LF, worktree LF toàn bộ, autocrlf=true', () => {
    const repo = prepare('true', 'lf', 'L1\nA2\nL3\nL4\nA5\n');
    firstPair(repo, 'stage');
    expectBytes(repo.indexBlob('data.txt'), 'L1\nA2\nL3\nL4\nL5\n');
    expectBytes(repo.readFile('data.txt'), 'L1\nA2\nL3\nL4\nA5\n');
  });

  it('huỷ dòng khi autocrlf=true mà worktree toàn LF: git áp patch rồi đổi CẢ FILE sang CRLF (smudge)', () => {
    const repo = prepare('true', 'lf', 'L1\nA2\nL3\nL4\nA5\n');
    firstPair(repo, 'discard');
    expectBytes(repo.readFile('data.txt'), 'L1\r\nL2\r\nL3\r\nL4\r\nA5\r\n');
    expectBytes(repo.indexBlob('data.txt'), 'L1\nL2\nL3\nL4\nL5\n');
  });

  it('huỷ dòng khi autocrlf=true mà worktree lẫn LF/CRLF: cả file thành CRLF', () => {
    const repo = prepare('true', 'lf', 'L1\nA2\r\nL3\nL4\r\nA5\n');
    firstPair(repo, 'discard');
    expectBytes(repo.readFile('data.txt'), 'L1\r\nL2\r\nL3\r\nL4\r\nA5\r\n');
  });

  it('huỷ dòng khi autocrlf=input mà worktree toàn CRLF: git chuẩn hoá cả file về LF', () => {
    const repo = prepare('input', 'lf', 'L1\r\nA2\r\nL3\r\nL4\r\nA5\r\n');
    firstPair(repo, 'stage');
    expectBytes(repo.indexBlob('data.txt'), 'L1\nA2\nL3\nL4\nL5\n');
    expectBytes(repo.readFile('data.txt'), 'L1\r\nA2\r\nL3\r\nL4\r\nA5\r\n');
    const discard = prepare('input', 'lf', 'L1\r\nA2\r\nL3\r\nL4\r\nA5\r\n');
    firstPair(discard, 'discard');
    expectBytes(discard.readFile('data.txt'), 'L1\nL2\nL3\nL4\nA5\n');
  });

  it('autocrlf=false, index LF, worktree CRLF toàn bộ (mọi dòng "đổi" chỉ vì xuống dòng): chỉ dòng được chọn đổi', () => {
    const stage = prepare('false', 'lf', 'L1\r\nA2\r\nL3\r\nL4\r\nA5\r\n');
    firstPair(stage, 'stage');
    expectBytes(stage.indexBlob('data.txt'), 'L1\r\nL2\nL3\nL4\nL5\n');
    expectBytes(stage.readFile('data.txt'), 'L1\r\nA2\r\nL3\r\nL4\r\nA5\r\n');

    const discard = prepare('false', 'lf', 'L1\r\nA2\r\nL3\r\nL4\r\nA5\r\n');
    firstPair(discard, 'discard');
    expectBytes(discard.readFile('data.txt'), 'L1\nA2\r\nL3\r\nL4\r\nA5\r\n');
    expectBytes(discard.indexBlob('data.txt'), 'L1\nL2\nL3\nL4\nL5\n');
  });

  it('autocrlf=false, index CRLF (-text), worktree LF toàn bộ: stage một dòng chỉ làm dòng đó thành LF trong index', () => {
    const repo = prepare('false', 'crlf-text-off', 'L1\nA2\nL3\nL4\nA5\n');
    firstPair(repo, 'stage');
    expectBytes(repo.indexBlob('data.txt'), 'L1\nL2\r\nL3\r\nL4\r\nL5\r\n');
  });

  it('autocrlf=true, index lẫn LF/CRLF (cũ), worktree CRLF toàn bộ: không chuẩn hoá (git thấy CR trong index)', () => {
    const repo = prepare('true', 'mixed', 'L1\r\nA2\r\nL3\r\nL4\r\nA5\r\n');
    firstPair(repo, 'stage');
    expectBytes(repo.indexBlob('data.txt'), 'L1\r\nL2\r\nL3\nL4\r\nL5\n');
    expectBytes(repo.readFile('data.txt'), 'L1\r\nA2\r\nL3\r\nL4\r\nA5\r\n');
  });
});
