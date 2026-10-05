// Randomised testing (fixed PRNG, so it is reproducible) of PatchBuilder against REAL git. Each round generates random
// old/new files (LF/CRLF/mixed, missing final newline, non-UTF-8 bytes), picks a random line set and checks all three
// operations:
//   stage (apply forward into the index), unstage (apply in reverse into the index), discard (apply in reverse into the
//   working tree).
// Three "witnesses" independent of the patch builder:
//   1. git apply must succeed;
//   2. a STRICT hand-written patch applier (exact position, exact context, exact header counts) must reproduce git's
//      result;
//   3. a tag-order semantic model (every line has a unique id): the result must be a valid merge of the "kept old
//      lines" and the "selected new lines", preserving old order, new order, and each line's bytes exactly.

import { afterEach, describe, expect, it } from 'vitest';
import { type DiffHunk, type FileDiff, isChangeLine, makePatch, parseDiff } from '../src/diff/index.ts';
import { TempRepo, latin1, showBytes } from './helpers/git-cli.ts';

type Eol = '' | '\n' | '\r\n';
interface Line {
  readonly text: string; // one character = one byte (latin1)
  readonly eol: Eol;
}
type Op = 'stage' | 'unstage' | 'discard';

const repos: TempRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

// MARK: - Strict patch applier (a witness independent of git)

interface Record {
  readonly kind: 'context' | 'addition' | 'deletion';
  readonly line: Line;
}

function recordsOf(hunk: DiffHunk): Record[] {
  const records: Record[] = [];
  hunk.lines.forEach((entry, index) => {
    if (entry.kind === 'noNewline') return;
    const raw = String.fromCharCode(...entry.text);
    const unterminated = hunk.lines[index + 1]?.kind === 'noNewline';
    const line: Line = unterminated
      ? { text: raw, eol: '' }
      : raw.endsWith('\r')
        ? { text: raw.slice(0, -1), eol: '\r\n' }
        : { text: raw, eol: '\n' };
    records.push({ kind: entry.kind, line });
  });
  return records;
}

/**
 * Apply a patch to `target` with strict unified-diff semantics, no leniency: the start position, every context/deleted line,
 * the header counts and the resulting side's position must all match exactly (git tolerates position drift).
 * `reverse` = apply in reverse.
 */
function strictApply(target: readonly Line[], patch: Uint8Array, reverse: boolean): Line[] {
  const [file] = parseDiff(patch);
  if (!file) throw new Error('patch không parse được');
  const result: Line[] = [];
  let cursor = 0;
  for (const hunk of file.hunks) {
    const targetStart = reverse ? hunk.newStart : hunk.oldStart;
    const targetCount = reverse ? hunk.newCount : hunk.oldCount;
    const resultStart = reverse ? hunk.oldStart : hunk.newStart;
    const resultCount = reverse ? hunk.oldCount : hunk.newCount;
    const at = targetCount === 0 ? targetStart : targetStart - 1;
    expect(at, 'hunk chồng lấn hoặc sai thứ tự').toBeGreaterThanOrEqual(cursor);
    result.push(...target.slice(cursor, at));
    cursor = at;
    expect(resultCount === 0 ? resultStart : resultStart - 1, 'vị trí phía kết quả trong header sai').toBe(
      result.length,
    );
    let consumed = 0;
    let produced = 0;
    for (const { kind, line } of recordsOf(hunk)) {
      const inTarget = kind === 'context' || kind === (reverse ? 'addition' : 'deletion');
      const inResult = kind === 'context' || kind === (reverse ? 'deletion' : 'addition');
      if (inTarget) {
        expect(target[cursor], `dòng ${cursor + 1} của file đích không khớp patch`).toEqual(line);
        cursor += 1;
        consumed += 1;
      }
      if (inResult) {
        result.push(line);
        produced += 1;
      }
    }
    expect(consumed, 'số dòng phía đích trong header sai').toBe(targetCount);
    expect(produced, 'số dòng phía kết quả trong header sai').toBe(resultCount);
  }
  result.push(...target.slice(cursor));
  return result;
}

// MARK: - Data generation

interface Version {
  readonly id: string;
  readonly line: Line;
}

const FILLERS = [
  '',
  'abc',
  'tab\there',
  '  kho\xe1\xba\xa3ng tr\xe1\xba\xafng  ', // "khoảng trắng" is valid UTF-8, written as raw bytes
  'caf\xe9', // CP1252 (not UTF-8)
  'Vi\xea\xf2t Nam', // CP1258
  'Vi\xe1\xbb\x87t Nam', // UTF-8
  '}',
  '--- x',
  '+++ y',
  '@@ -1 +1 @@',
  '\\ No newline at end of file',
];

function generateUnique(random: () => number): { oldV: Version[]; newV: Version[] } {
  const crlfBias = [0, 1, 0.4][Math.floor(random() * 3)]!;
  const pickEol = (): Eol => (random() < crlfBias ? '\r\n' : '\n');
  const filler = () => FILLERS[Math.floor(random() * FILLERS.length)]!;
  let counter = 0;
  const fresh = (eol: Eol = pickEol()): Version => {
    const id = `n${counter++}`;
    return { id, line: { text: `${id}|${filler()}`, eol } };
  };

  const count = 3 + Math.floor(random() * 12);
  const oldV: Version[] = Array.from({ length: count }, (_, i) => ({
    id: `o${i}`,
    line: { text: `o${i}|${filler()}`, eol: pickEol() },
  }));
  if (random() < 0.3) oldV[count - 1] = { ...oldV[count - 1]!, line: { ...oldV[count - 1]!.line, eol: '' } };

  const newV: Version[] = [];
  if (random() < 0.1) newV.push(fresh());
  for (const version of oldV) {
    const roll = random();
    if (roll >= 0.5) newV.push(version);
    else if (roll >= 0.25) newV.push(fresh());
    if (random() < 0.2)
      for (let k = 0, extra = 1 + Math.floor(random() * 2); k < extra; k++) newV.push(fresh());
  }
  if (newV.length === 0) newV.push(fresh());
  // Only the last line may lack a newline; flipping a line's newline state while its text stays the same counts as a change (new id).
  const wantFinal: Eol = random() < 0.3 ? '' : pickEol();
  const last = newV[newV.length - 1]!;
  newV[newV.length - 1] = last.line.eol === wantFinal ? last : fresh(wantFinal);
  for (let i = 0; i < newV.length - 1; i++) if (newV[i]!.line.eol === '') newV[i] = fresh();
  if (newV.length === oldV.length && newV.every((v, i) => v === oldV[i])) newV.push(fresh());
  // After the push the old last line is no longer last: make sure it has a newline.
  for (let i = 0; i < newV.length - 1; i++) if (newV[i]!.line.eol === '') newV[i] = fresh();
  return { oldV, newV };
}

/** Repeated content (a small alphabet): hunk positions must be exact because the context matches in many places. */
function generateDuplicates(random: () => number): { oldLines: Line[]; newLines: Line[] } {
  const alphabet = ['a', 'b', '', '}', 'x y'];
  const crlfBias = [0, 1, 0.4][Math.floor(random() * 3)]!;
  const line = (eol?: Eol): Line => ({
    text: alphabet[Math.floor(random() * alphabet.length)]!,
    eol: eol ?? (random() < crlfBias ? '\r\n' : '\n'),
  });
  const build = (length: number, finalEol: Eol): Line[] => {
    const lines = Array.from({ length }, () => line());
    lines[length - 1] = line(finalEol);
    return lines;
  };
  const oldLines = build(6 + Math.floor(random() * 12), random() < 0.3 ? '' : '\n');
  const newLines: Line[] = [];
  for (const entry of oldLines) {
    const roll = random();
    if (roll >= 0.4) newLines.push(entry);
    else if (roll >= 0.2) newLines.push(line());
    if (random() < 0.15) newLines.push(line());
  }
  if (newLines.length === 0) newLines.push(line());
  const finalEol: Eol = random() < 0.3 ? '' : '\n';
  newLines[newLines.length - 1] = { ...newLines[newLines.length - 1]!, eol: finalEol };
  for (let i = 0; i < newLines.length - 1; i++)
    if (newLines[i]!.eol === '') newLines[i] = { ...newLines[i]!, eol: '\n' };
  return { oldLines, newLines };
}

// MARK: - Running one round

function newRepo(): TempRepo {
  const repo = TempRepo.create({ autocrlf: 'false' });
  repos.push(repo);
  return repo;
}

function commitContent(repo: TempRepo, bytes: Uint8Array): void {
  repo.writeFile('data.txt', bytes);
  repo.add('data.txt');
  repo.git('commit', ['-q', '--allow-empty', '--no-verify', '-m', 'i']);
}

function randomSelection(file: FileDiff, random: () => number): Map<number, Set<number>> {
  const all: [number, number][] = [];
  for (const hunk of file.hunks)
    hunk.lines.forEach((line, index) => isChangeLine(line) && all.push([hunk.id, index]));
  const selection = new Map<number, Set<number>>();
  const add = (hunkId: number, index: number) => {
    const set = selection.get(hunkId) ?? new Set<number>();
    set.add(index);
    selection.set(hunkId, set);
  };
  const density = [0.2, 0.5, 0.8][Math.floor(random() * 3)]!;
  for (const [hunkId, index] of all) if (random() < density) add(hunkId, index);
  if (selection.size === 0 && all.length > 0) {
    const [hunkId, index] = all[Math.floor(random() * all.length)]!;
    add(hunkId, index);
  }
  return selection;
}

const idOf = (text: string): string => text.slice(0, text.indexOf('|'));

/** Selected (deleted / added) ids taken from the diff selection, used by the tag model. */
function selectedIds(file: FileDiff, selection: Map<number, Set<number>>) {
  const deleted = new Set<string>();
  const added = new Set<string>();
  for (const hunk of file.hunks) {
    for (const index of selection.get(hunk.id) ?? []) {
      const entry = hunk.lines[index]!;
      const text = String.fromCharCode(...entry.text).replace(/\r$/, '');
      if (entry.kind === 'deletion') deleted.add(idOf(text));
      else if (entry.kind === 'addition') added.add(idOf(text));
    }
  }
  return { deleted, added };
}

function checkSemantics(
  oldV: readonly Version[],
  newV: readonly Version[],
  chosen: { deleted: Set<string>; added: Set<string> },
  reverse: boolean,
  result: readonly Line[],
): void {
  const oldIds = oldV.map((v) => v.id);
  const newIds = newV.map((v) => v.id);
  const common = new Set(newIds.filter((id) => oldIds.includes(id)));
  // Both sequences must keep their order in the result: the "old" and the "new" one (common lines are in both).
  const seqOld = reverse
    ? oldIds.filter((id) => common.has(id) || chosen.deleted.has(id))
    : oldIds.filter((id) => !chosen.deleted.has(id));
  const seqNew = reverse
    ? newIds.filter((id) => !chosen.added.has(id))
    : newIds.filter((id) => common.has(id) || chosen.added.has(id));

  const ids = result.map((line) => idOf(line.text));
  expect(new Set(ids).size, 'kết quả có dòng lặp').toBe(ids.length);
  expect([...new Set(ids)].sort()).toEqual([...new Set([...seqOld, ...seqNew])].sort());
  const inOld = new Set(seqOld);
  const inNew = new Set(seqNew);
  expect(
    ids.filter((id) => inOld.has(id)),
    'sai thứ tự các dòng cũ còn giữ',
  ).toEqual(seqOld);
  expect(
    ids.filter((id) => inNew.has(id)),
    'sai thứ tự các dòng mới được chọn',
  ).toEqual(seqNew);

  const versions = new Map([...oldV, ...newV].map((v) => [v.id, v.line]));
  result.forEach((line, index) => {
    const source = versions.get(ids[index]!)!;
    expect(line.text, `nội dung dòng ${ids[index]}`).toBe(source.text);
    const isLast = index === result.length - 1;
    if (source.eol === '') {
      // A line that originally had no newline may only stay that way while it is still the last one; otherwise it must gain a newline.
      if (isLast) expect(line.eol, `dòng cuối ${ids[index]} phải không có newline`).toBe('');
      else
        expect(['\n', '\r\n'], `dòng ${ids[index]} không phải dòng cuối nên cần newline`).toContain(line.eol);
    } else {
      expect(line.eol, `xuống dòng của ${ids[index]}`).toBe(source.eol);
    }
  });
}

function runOp(
  repo: TempRepo,
  op: Op,
  target: readonly Line[],
  random: () => number,
  verify: (file: FileDiff, selection: Map<number, Set<number>>, result: Line[]) => void,
): void {
  const file = parseDiff(repo.diffBytes(op === 'unstage' ? 'staged' : 'unstaged', 'data.txt'))[0];
  if (!file) throw new Error('không có diff');
  const selection = randomSelection(file, random);
  const patch = makePatch(file, selection, op !== 'stage');
  if (patch === null) throw new Error('không dựng được patch');
  const applied = repo.applyPatch(patch, { cached: op !== 'discard', reverse: op !== 'stage' });
  if (applied.code !== 0)
    throw new Error(`git apply thất bại (${op}): ${applied.stderr}\n${showBytes(patch)}`);
  const actual = parseLines(op === 'discard' ? repo.readFile('data.txt') : repo.indexBlob('data.txt'));

  // Witness 2: the strict applier must reproduce git's result byte for byte.
  const strict = strictApply(target, patch, op !== 'stage');
  expect(showBytes(toBytes(strict)), `bộ áp nghiêm ngặt khác git (${op})`).toBe(showBytes(toBytes(actual)));
  // Witness 3: the semantics.
  verify(file, selection, actual);
}

const BATCHES = 6;
const PER_BATCH = 8;

describe('PatchBuilder ngẫu nhiên vs git thật: dòng có id duy nhất (kiểm ngữ nghĩa + bộ áp nghiêm ngặt)', () => {
  for (let batch = 0; batch < BATCHES; batch++) {
    it(`lô ${batch + 1}/${BATCHES} (seed ${batch * PER_BATCH + 1}…${(batch + 1) * PER_BATCH})`, () => {
      const repo = newRepo();
      for (let seed = batch * PER_BATCH + 1; seed <= (batch + 1) * PER_BATCH; seed++) {
        const random = mulberry32(seed);
        const { oldV, newV } = generateUnique(random);
        const oldLines = oldV.map((v) => v.line);
        const newLines = newV.map((v) => v.line);
        const context = `seed=${seed}\n--- cũ ---\n${showBytes(toBytes(oldLines))}\n--- mới ---\n${showBytes(toBytes(newLines))}`;
        try {
          commitContent(repo, toBytes(oldLines));
          repo.writeFile('data.txt', toBytes(newLines));

          // stage: apply forward into the index (index = old).
          runOp(repo, 'stage', oldLines, random, (file, selection, result) =>
            checkSemantics(oldV, newV, selectedIds(file, selection), false, result),
          );
          expect(showBytes(repo.readFile('data.txt'))).toBe(showBytes(toBytes(newLines)));
          repo.git('reset', ['-q']);

          // discard: apply in reverse into the working tree (working tree = new).
          runOp(repo, 'discard', newLines, random, (file, selection, result) =>
            checkSemantics(oldV, newV, selectedIds(file, selection), true, result),
          );
          repo.writeFile('data.txt', toBytes(newLines));

          // unstage: apply in reverse into the index (index = new after `git add`).
          repo.add('data.txt');
          runOp(repo, 'unstage', newLines, random, (file, selection, result) =>
            checkSemantics(oldV, newV, selectedIds(file, selection), true, result),
          );
        } catch (error) {
          throw new Error(`${(error as Error).message}\n${context}`, { cause: error });
        }
      }
    });
  }
});

describe('PatchBuilder ngẫu nhiên vs git thật: nội dung lặp (vị trí hunk phải đúng tuyệt đối)', () => {
  for (let batch = 0; batch < BATCHES; batch++) {
    it(`lô ${batch + 1}/${BATCHES}`, () => {
      const repo = newRepo();
      for (let seed = 1000 + batch * PER_BATCH; seed < 1000 + (batch + 1) * PER_BATCH; seed++) {
        const random = mulberry32(seed);
        const { oldLines, newLines } = generateDuplicates(random);
        if (showBytes(toBytes(oldLines)) === showBytes(toBytes(newLines))) continue;
        const context = `seed=${seed}\n--- cũ ---\n${showBytes(toBytes(oldLines))}\n--- mới ---\n${showBytes(toBytes(newLines))}`;
        try {
          commitContent(repo, toBytes(oldLines));
          repo.writeFile('data.txt', toBytes(newLines));
          const noCheck = () => undefined;
          runOp(repo, 'stage', oldLines, random, noCheck);
          repo.git('reset', ['-q']);
          runOp(repo, 'discard', newLines, random, noCheck);
          repo.writeFile('data.txt', toBytes(newLines));
          repo.add('data.txt');
          runOp(repo, 'unstage', newLines, random, noCheck);

          // Select ALL change lines: the result must equal the opposite side byte for byte.
          const [file] = parseDiff(repo.diffBytes('staged', 'data.txt'));
          if (file) {
            const everything = new Map<number, Set<number>>();
            for (const hunk of file.hunks) {
              everything.set(
                hunk.id,
                new Set(hunk.lines.flatMap((line, index) => (isChangeLine(line) ? [index] : []))),
              );
            }
            const patch = makePatch(file, everything, true);
            if (patch !== null) {
              const staged = parseLines(repo.indexBlob('data.txt'));
              expect(showBytes(toBytes(strictApply(staged, patch, true)))).toBe(showBytes(toBytes(oldLines)));
            }
          }
        } catch (error) {
          throw new Error(`${(error as Error).message}\n${context}`, { cause: error });
        }
      }
    });
  }
});
