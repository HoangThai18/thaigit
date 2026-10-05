// CRLF matrix (FM8/AD9) against REAL git in an isolated temp repo, comparing the BYTES of the index blob
// (`git cat-file blob :path`) and the working-tree file:
//   {core.autocrlf true | input | false} × {index LF | CRLF with `-text` | legacy CRLF (no attribute) | mixed LF/CRLF}
//   × {file ends with a newline | no final newline} × {select line 2 | select the last line} × {stage | unstage | discard}
// Expectations come from an INDEPENDENT MODEL (only the selected line changes, every other byte is preserved) rather
// than from the code under test — so the tests can fail. Some cells add a golden answer spelled out byte by byte. The
// last group records git's behaviour when the working tree's line terminators differ from the config (git apply
// normalises the whole file when discarding a line).

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

/** Blob content in the index at the start. The last line has a newline or not according to `finalEol`. */
function baseLines(kind: IndexKind, finalEol: boolean): Line[] {
  const eolOf = (i: number): Eol =>
    kind === 'lf' ? '\n' : kind === 'mixed' ? (i % 2 === 0 ? '\n' : '\r\n') : '\r\n';
  return ['L1', 'L2', 'L3', 'L4', 'L5'].map((text, i) => ({
    text,
    eol: i === 4 && !finalEol ? '' : eolOf(i),
  }));
}

/** Does git's "clean" filter run at diff/add time: autocrlf=true|input, no CR in the index file, no `-text`. */
const normalizes = (autocrlf: AutoCrlf, kind: IndexKind): boolean => autocrlf !== 'false' && kind === 'lf';

/** Line as `git diff` shows it: CRLF becomes LF once the clean filter runs. */
const asDiffed = (line: Line, normalize: boolean): Line =>
  normalize && line.eol === '\r\n' ? { text: line.text, eol: '\n' } : line;

/**
 * Sample repo per (autocrlf, index kind, final newline): commit the raw content (autocrlf=false), switch the config,
 * then check out again so the working tree matches what git would create. Each matrix cell copies this sample
 * (cheaper than rebuilding it with 5 git commands).
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
  // Edit line 2 and line 5 the way an editor would: each line keeps its own line terminator.
  const edited = editedOverride
    ? editedOverride(wt0)
    : wt0.map((line, i) => (i === 1 ? { ...line, text: 'A2' } : i === 4 ? { ...line, text: 'A5' } : line));
  repo.writeFile('data.txt', toBytes(edited));
  return { repo, base, wt0, edited };
}

/** Pick the deleted+added pair of one line (identified by the L2/A2 or L5/A5 text; possibly carrying "\r"). */
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
                // Index: the base with the selected line replaced by what `git diff` shows; the working tree is unchanged.
                const expected = base.map((line, i) =>
                  i === position ? asDiffed(edited[i]!, normalize) : line,
                );
                expectBytes(repo.indexBlob('data.txt'), toBytes(expected));
                expectBytes(repo.readFile('data.txt'), wtBefore);
              } else if (op === 'unstage') {
                // After `git add` the index is the cleaned working tree; unstaging just the selected line returns that line to its HEAD form.
                const staged = edited.map((line) => asDiffed(line, normalize));
                const expected = staged.map((line, i) => (i === position ? base[i]! : line));
                expectBytes(repo.indexBlob('data.txt'), toBytes(expected));
                expectBytes(repo.readFile('data.txt'), wtBefore);
              } else {
                // Discarding the selected line from the working tree: that line returns to exactly its checkout bytes, every other line is unchanged.
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
  // Working tree after checkout: only index LF + autocrlf=true is turned into CRLF by git; every other cell keeps the blob's bytes.
  interface Golden {
    /** Working tree after editing lines 2 and 5. */
    edited: string;
    /** Index after staging just the line-2 change. */
    stageSecondIndex: string;
    /** Index after staging everything and then unstaging just the line-5 change. */
    unstageLastIndex: string;
    /** Working tree after discarding just the line-5 change. */
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
  // Index LF + autocrlf=true: the working tree is CRLF while the blob in the index stays LF.
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
      // stage line 2
      let cell = setup(autocrlf, kind, true);
      expectBytes(cell.repo.readFile('data.txt'), golden.edited);
      applySelected(cell.repo, 'stage', pickLine('second'));
      expectBytes(cell.repo.indexBlob('data.txt'), golden.stageSecondIndex);
      expectBytes(cell.repo.readFile('data.txt'), golden.edited);

      // unstage the last line
      cell = setup(autocrlf, kind, true);
      cell.repo.add('data.txt');
      applySelected(cell.repo, 'unstage', pickLine('last'));
      expectBytes(cell.repo.indexBlob('data.txt'), golden.unstageLastIndex);
      expectBytes(cell.repo.readFile('data.txt'), golden.edited);

      // discard the last line
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
  /** Pick the first deleted+added pair in the single hunk (exactly how a user picks "the first changed line"). */
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
