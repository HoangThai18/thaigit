// Rebase tương tác: kiểm kế hoạch (thuần), luật soạn todo của bộ chuyển Node (cùng luật với rebase.rs) và chạy thật trên git.
import { describe, expect, it } from 'vitest';
import { GitError, rebasePlanProblem, type Commit, type RebaseStep } from '../src/git/index.ts';
import { buildRebaseTodo, sequenceEditor, validateRebasePlan } from '../src/node/rebase-todo.ts';
import { withTestRepo, type TestRepo } from './helpers/test-repo.ts';

function commit(id: string, parents: string[] = ['p']): Commit {
  return {
    id,
    parents,
    authorName: 'A',
    authorEmail: 'a@x',
    authorDate: 0,
    committerName: 'A',
    committerEmail: 'a@x',
    commitDate: 0,
    subject: id,
  };
}

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

describe('rebasePlanProblem', () => {
  const [one, two] = [commit('1'), commit('2')];
  const pick = (c: Commit): RebaseStep => ({ commit: c, action: 'pick' });

  it('nhận ra kế hoạch rỗng, có merge, gộp ở đầu, message trống, bỏ hết, không đổi gì', () => {
    expect(rebasePlanProblem([], [])).toBe('empty');
    expect(rebasePlanProblem([pick(commit('m', ['x', 'y']))], [])).toBe('merge');
    expect(
      rebasePlanProblem(
        [
          { commit: one, action: 'drop' },
          { commit: two, action: 'squash' },
        ],
        [one, two],
      ),
    ).toBe('leadingSquash');
    expect(
      rebasePlanProblem([pick(one), { commit: two, action: 'reword', message: ' \n' }], [one, two]),
    ).toBe('emptyMessage');
    expect(rebasePlanProblem([{ commit: one, action: 'drop' }], [one])).toBe('allDropped');
    expect(rebasePlanProblem([pick(one), pick(two)], [one, two])).toBe('unchanged');
    expect(rebasePlanProblem([pick(two), pick(one)], [one, two])).toBeNull();
    expect(rebasePlanProblem([pick(one), { commit: two, action: 'fixup' }], [one, two])).toBeNull();
  });
});

describe('soạn todo (bộ chuyển Node, cùng luật với rebase.rs)', () => {
  it('chỉ nhận sha đầy đủ, không trùng; message đi qua file, không bao giờ vào todo', () => {
    expect(() => validateRebasePlan(A, [{ action: 'pick', sha: B }])).not.toThrow();
    for (const sha of ['HEAD', '-x', `${B}\nexec id`]) {
      expect(() => validateRebasePlan(A, [{ action: 'pick', sha }])).toThrow(/rebase/);
    }
    expect(() => validateRebasePlan('HEAD~1', [{ action: 'pick', sha: B }])).toThrow();
    expect(() =>
      validateRebasePlan(A, [
        { action: 'pick', sha: B },
        { action: 'drop', sha: B },
      ]),
    ).toThrow();
    const todo = buildRebaseTodo(
      [
        { action: 'pick', sha: A },
        { action: 'reword', sha: B, message: "x'; touch /tmp/pwned; echo '" },
      ],
      (index) => `/repo's/.git/thaigit-rebase/message-${index}`,
    );
    expect(todo).toBe(
      `pick ${A}\npick ${B}\nexec git commit --amend --only --no-verify --allow-empty --cleanup=whitespace -F '/repo'\\''s/.git/thaigit-rebase/message-1'\n`,
    );
    expect(sequenceEditor('/a b/todo')).toBe(
      `while IFS= read -r line; do printf '%s\\n' "$line"; done < '/a b/todo' >`,
    );
  });
});

/** gốc → một → hai → ba (mỗi commit một file). Trả sha của gốc và ba commit sau. */
async function linear(t: TestRepo): Promise<{ base: string; shas: string[] }> {
  await t.write('gốc.txt', 'gốc\n');
  await t.commitAll('gốc');
  const base = await t.repo.resolveCommit('HEAD');
  const shas: string[] = [];
  for (const name of ['một', 'hai', 'ba']) {
    await t.write(`${name}.txt`, `${name}\n`);
    await t.commitAll(name);
    shas.push(await t.repo.resolveCommit('HEAD'));
  }
  return { base, shas };
}

describe('GitRepository.interactiveRebase', () => {
  it('rebaseCommits liệt kê cũ → mới; commit ngoài nhánh hiện tại → null', () =>
    withTestRepo(async (t) => {
      const { base, shas } = await linear(t);
      expect((await t.repo.rebaseCommits(base))?.map((c) => c.id)).toEqual(shas);
      t.git('switch', '-q', '-c', 'khac', base);
      await t.write('khác.txt', 'x\n');
      await t.commitAll('khác');
      const other = await t.repo.resolveCommit('HEAD');
      t.git('switch', '-q', 'main');
      expect(await t.repo.rebaseCommits(other)).toBeNull();
    }));

  it('đảo thứ tự, reword, gộp, bỏ — giữ thay đổi chưa commit', () =>
    withTestRepo(async (t) => {
      const { base } = await linear(t);
      const commits = (await t.repo.rebaseCommits(base))!;
      await t.write('đang sửa.txt', 'chưa commit\n');
      const result = await t.repo.interactiveRebase(base, [
        { commit: commits[2]!, action: 'reword', message: 'Ba — message mới\n\n#12 vẫn giữ\n' },
        { commit: commits[0]!, action: 'pick' },
        { commit: commits[1]!, action: 'fixup' },
      ]);
      expect(result).toBe('done');
      expect(t.git('log', '--format=%s', '-n3').trim().split('\n')).toEqual([
        'một',
        'Ba — message mới',
        'gốc',
      ]);
      expect(t.git('log', '-1', '--skip=1', '--format=%B').trim()).toBe('Ba — message mới\n\n#12 vẫn giữ');
      expect(await t.exists('hai.txt')).toBe(true);
      expect(await t.read('đang sửa.txt')).toBe('chưa commit\n');
    }));

  it('xung đột: ném GitError, repo ở trạng thái rebase; huỷ trả lại như cũ', () =>
    withTestRepo(async (t) => {
      await t.write('a.txt', '1\n');
      await t.commitAll('gốc');
      const base = await t.repo.resolveCommit('HEAD');
      await t.write('a.txt', '2\n');
      await t.commitAll('hai');
      await t.write('a.txt', '3\n');
      await t.commitAll('ba');
      const head = await t.repo.resolveCommit('HEAD');
      const [two, three] = (await t.repo.rebaseCommits(base))!;
      const error = await t.repo
        .interactiveRebase(base, [
          { commit: three!, action: 'pick' },
          { commit: two!, action: 'pick' },
        ])
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GitError);
      expect((error as GitError).contains('CONFLICT')).toBe(true);
      const operation = await t.repo.operationState();
      expect(operation?.kind).toBe('rebasing');
      await t.repo.abort(operation!);
      expect(await t.repo.resolveCommit('HEAD')).toBe(head);
    }));
});
