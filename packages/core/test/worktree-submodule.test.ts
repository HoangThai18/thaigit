// Worktrees / submodules: the pure parsers plus operations on real git (through NodeExec and the policy).
import { realpathSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSubmoduleStatus, parseWorktrees } from '../src/git/index.ts';
import { createTestRepoIn, rawGit, withTempDir, withTestRepo } from './helpers/test-repo.ts';

describe('parser', () => {
  it('parseWorktrees: nhánh, detached, bare, locked, prunable', () => {
    const data =
      'worktree /a/repo\0HEAD aaaa\0branch refs/heads/main\0\0' +
      'worktree /a/repo x\0HEAD bbbb\0detached\0locked\0\0' +
      'worktree /a/mất\0HEAD cccc\0branch refs/heads/cũ\0prunable gitdir file points to non-existent location\0\0';
    expect(parseWorktrees(data)).toEqual([
      { path: '/a/repo', head: 'aaaa', branch: 'main', bare: false, locked: false, prunable: false },
      { path: '/a/repo x', head: 'bbbb', branch: null, bare: false, locked: true, prunable: false },
      { path: '/a/mất', head: 'cccc', branch: 'cũ', bare: false, locked: false, prunable: true },
    ]);
  });

  it('parseSubmoduleStatus: trạng thái, đường dẫn có dấu cách, mô tả', () => {
    const data = [
      ' 1111111111111111111111111111111111111111 vendor/lib (v1.2-3-gabc)',
      '-2222222222222222222222222222222222222222 thư viện/có cách',
      '+3333333333333333333333333333333333333333 khac (heads/main)',
      'U4444444444444444444444444444444444444444 xung-dot',
      '',
    ].join('\n');
    expect(parseSubmoduleStatus(data)).toEqual([
      { path: 'vendor/lib', sha: '1'.repeat(40), state: 'ok', describe: 'v1.2-3-gabc' },
      { path: 'thư viện/có cách', sha: '2'.repeat(40), state: 'uninitialized', describe: '' },
      { path: 'khac', sha: '3'.repeat(40), state: 'modified', describe: 'heads/main' },
      { path: 'xung-dot', sha: '4'.repeat(40), state: 'conflict', describe: '' },
    ]);
  });
});

/** The same directory? Git on Windows prints `C:/…/x` (forward slashes) while `path.join` gives `C:\\…\\x` — compare via realpath. */
const samePath = (a: string | undefined, b: string): boolean =>
  a !== undefined && realpathSync(a) === realpathSync(b);

describe('worktree trên git thật', () => {
  it('liệt kê, thêm (nhánh mới / nhánh có sẵn), gỡ, dọn', () =>
    withTestRepo(async (t) => {
      await t.write('a.txt', '1\n');
      await t.commitAll('gốc');
      const parent = join(t.root, '..');
      const added = await t.repo.addWorktree(parent, 'repo-moi', 'tinh-nang', true);
      t.git('branch', 'co-san');
      const existing = await t.repo.addWorktree(parent, 'repo-co-san', 'co-san', false);
      let list = await t.repo.worktrees();
      expect(list.map((item) => item.branch).sort()).toEqual(['co-san', 'main', 'tinh-nang']);
      expect(samePath(list.find((item) => item.branch === 'tinh-nang')?.path, added)).toBe(true);
      await expect(t.repo.addWorktree(parent, 'x', '--detach', false)).rejects.toThrow();

      await t.repo.removeWorktree(added, false);
      // The worktree directory was deleted outside the app: git marks it prunable, `worktree prune` cleans it up.
      const existingPath = list.find((item) => item.branch === 'co-san')?.path;
      expect(samePath(existingPath, existing)).toBe(true);
      await rm(existing, { recursive: true, force: true });
      list = await t.repo.worktrees();
      expect(list.find((item) => item.path === existingPath)?.prunable).toBe(true);
      await t.repo.pruneWorktrees();
      expect((await t.repo.worktrees()).map((item) => item.branch)).toEqual(['main']);
    }));
});

describe('submodule trên git thật', () => {
  it('repo không có .gitmodules → rỗng; clone xong thì chưa init, update --init thì ok', () =>
    withTempDir(async (dir) => {
      const libDir = join(dir, 'lib');
      await mkdir(libDir);
      const lib = await createTestRepoIn(libDir);
      await lib.write('lib.txt', 'lib\n');
      await lib.commitAll('lib');

      const appDir = join(dir, 'app');
      await mkdir(appDir);
      const app = await createTestRepoIn(appDir);
      await app.write('a.txt', '1\n');
      await app.commitAll('gốc');
      expect(await app.repo.submodules()).toEqual([]);
      app.git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', libDir, 'vendor/lib');
      app.git('commit', '-qm', 'thêm submodule');
      expect((await app.repo.submodules()).map((item) => [item.path, item.state])).toEqual([
        ['vendor/lib', 'ok'],
      ]);

      // The parent repo's clone: the submodule is not initialised yet.
      const cloneDir = join(dir, 'ban-sao');
      rawGit(dir, ['clone', '-q', appDir, cloneDir], app.config);
      const { openRepository } = await import('../src/node/index.ts');
      const clone = await openRepository(cloneDir, { ...app.config });
      expect((await clone.submodules()).map((item) => item.state)).toEqual(['uninitialized']);
      // The submodule URL is a local path: the policy blocks file:// for submodules (protocol.file.allow=user)
      // so update must fail — the correct safe behaviour for an untrusted repo.
      await expect(clone.updateSubmodules(null)).rejects.toThrow();
      await clone.syncSubmodules();
    }));
});
