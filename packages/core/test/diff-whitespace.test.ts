// Whitespace-ignoring diffs (`--ignore-all-space`) against real git.
import { describe, expect, it } from 'vitest';
import { withTestRepo } from './helpers/test-repo.ts';

describe('diff bỏ qua khoảng trắng', () => {
  it('chỉ đổi thụt lề thì diff rỗng; thay đổi thật vẫn hiện', () =>
    withTestRepo(async (t) => {
      await t.write('a.ts', 'function x() {\n  return 1;\n}\n');
      await t.commitAll('gốc');
      await t.write('a.ts', 'function x() {\n    return 1;\n}\n');
      const change = { path: 'a.ts', kind: 'modified' } as const;
      const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
      expect(text(await t.repo.workingDiffBytes(change, 'unstaged'))).toContain('+    return 1;');
      expect(text(await t.repo.workingDiffBytes(change, 'unstaged', 3, true))).toBe('');
      await t.commitAll('thụt lề');
      const head = await t.repo.resolveCommit('HEAD');
      const parent = await t.repo.resolveCommit('HEAD~1');
      expect(text(await t.repo.commitDiffBytes(head, parent, change, 3, true))).toBe('');
      await t.write('a.ts', 'function x() {\n    return 2;\n}\n');
      expect(text(await t.repo.workingDiffBytes(change, 'unstaged', 3, true))).toContain('+    return 2;');
    }));
});
