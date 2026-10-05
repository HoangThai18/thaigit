// Covers the remaining GitRepository operations (merge/rebase/cherry-pick/revert/reset, in-progress state, the three pull
// modes, tags/remotes, stash, log…). Every command goes through the real NodeExec and validator, so a valid command
// wrongly blocked by policy fails the tests.

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CancelledError,
  CommandLog,
  buildHistory,
  GitError,
  RepositoryError,
  headBranchName,
  headOid,
  isDetachedHead,
  isMergeCommit,
  isStatusClean,
  isUncommittedBlame,
  isWorkingTreeCommit,
  isUnbornHead,
  isValidRefName,
  refName,
  stashBranchName,
  stashDisplayMessage,
  type Commit,
} from '../src/git/index.ts';
import { openRepository } from '../src/node/index.ts';
import {
  IS_WINDOWS,
  cloneTestRepo,
  createBareRemote,
  createHangScript,
  isProcessAlive,
  isolatedConfig,
  rawGit,
  waitFor,
  withTempDir,
  withTestRepo,
  type TestRepo,
} from './helpers/test-repo.ts';

async function commitFile(t: TestRepo, path: string, content: string, message: string): Promise<string> {
  await t.write(path, content);
  await t.commitAll(message);
  return t.repo.resolveCommit('HEAD');
}

/** main: base → ours; other: base → theirs (both edit a.txt → conflict on merge). HEAD is on main. */
async function diverge(t: TestRepo): Promise<{ base: string; ours: string; theirs: string }> {
  const base = await commitFile(t, 'a.txt', 'x\n', 'base');
  await t.repo.createBranch('other', null, true);
  const theirs = await commitFile(t, 'a.txt', 'theirs\n', 'theirs');
  await t.repo.switchTo('main');
  const ours = await commitFile(t, 'a.txt', 'ours\n', 'ours');
  return { base, ours, theirs };
}

describe('Trạng thái thao tác dở dang (đọc từ git dir qua RepoFs)', () => {
  it('rebase (backend merge): bước/tổng/nhánh, skip, rồi tiếp tục sau khi giải quyết', () =>
    withTestRepo(async (t) => {
      await commitFile(t, 'a.txt', 'x\n', 'base');
      await t.repo.createBranch('other', null, true);
      await commitFile(t, 'a.txt', 'theirs\n', 'theirs');
      await t.repo.switchTo('main');
      await commitFile(t, 'a.txt', 'ours\n', 'ours: xung đột');
      const originalTip = await commitFile(t, 'b.txt', 'b\n', 'ours: không xung đột');

      await expect(t.repo.rebase('other')).rejects.toBeInstanceOf(GitError);
      const operation = await t.repo.operationState();
      expect(operation).toEqual({ kind: 'rebasing', step: 1, total: 2, headName: 'main' });
      expect((await t.repo.status()).conflicts).toEqual([{ path: 'a.txt', kind: 'bothModified' }]);

      // Skip the conflicting commit: the remaining ones apply cleanly and the rebase finishes.
      if (!operation) throw new Error('phải đang rebase');
      await t.repo.skip(operation);
      expect(await t.repo.operationState()).toBeNull();
      expect(await t.read('a.txt')).toBe('theirs\n');
      expect(await t.read('b.txt')).toBe('b\n');

      // Once again from the initial state, but resolving by hand and continuing.
      await t.repo.reset(originalTip, 'hard');
      await expect(t.repo.rebase('other')).rejects.toBeInstanceOf(GitError);
      await t.write('a.txt', 'gộp tay\n');
      await t.repo.markResolved(['a.txt']);
      await t.repo.continueOperation({ kind: 'rebasing', step: null, total: null, headName: null });
      expect(await t.repo.operationState()).toBeNull();
      const log = await t.repo.log({ limit: 10, order: 'topo', includeHead: true });
      expect(log.map((commit) => commit.subject)).toEqual([
        'ours: không xung đột',
        'ours: xung đột',
        'theirs',
        'base',
      ]);
      expect(log.some(isMergeCommit)).toBe(false);
      expect(await t.read('a.txt')).toBe('gộp tay\n');
    }));

  it('rebase --apply (thư mục rebase-apply) vẫn nhận ra là đang rebase', () =>
    withTestRepo(async (t) => {
      await diverge(t);
      await expect(t.repo.runner.run('rebase', ['--apply', 'other'])).rejects.toBeInstanceOf(GitError);
      expect(await t.repo.operationState()).toEqual({
        kind: 'rebasing',
        step: 1,
        total: 1,
        headName: 'main',
      });
      await t.repo.abort({ kind: 'rebasing', step: null, total: null, headName: null });
      expect(await t.repo.operationState()).toBeNull();
    }));

  it('cherry-pick và revert xung đột: nhận ra, huỷ được', () =>
    withTestRepo(async (t) => {
      const { theirs } = await diverge(t);
      await expect(t.repo.cherryPick(theirs)).rejects.toBeInstanceOf(GitError);
      expect(await t.repo.operationState()).toEqual({ kind: 'cherryPicking' });
      await t.repo.abort({ kind: 'cherryPicking' });
      expect(await t.repo.operationState()).toBeNull();

      const second = await commitFile(t, 'a.txt', 'hai\n', 'hai');
      await commitFile(t, 'a.txt', 'ba\n', 'ba');
      await expect(t.repo.revert(second)).rejects.toBeInstanceOf(GitError);
      expect(await t.repo.operationState()).toEqual({ kind: 'reverting' });
      await t.repo.abort({ kind: 'reverting' });
      expect(await t.repo.operationState()).toBeNull();
      expect(await t.read('a.txt')).toBe('ba\n');
    }));

  it('git am xung đột: applyingPatches, skip rồi xong', () =>
    withTestRepo(async (t) => {
      const { theirs } = await diverge(t);
      const patchDir = join(t.root, '..', 'patches');
      await mkdir(patchDir);
      t.git('format-patch', '-1', theirs, '-o', patchDir);
      const patch = join(patchDir, '0001-theirs.patch');
      await expect(t.repo.runner.run('am', [patch])).rejects.toBeInstanceOf(GitError);
      const operation = await t.repo.operationState();
      expect(operation).toEqual({ kind: 'applyingPatches' });
      if (!operation) throw new Error('phải đang áp patch');
      await t.repo.skip(operation);
      expect(await t.repo.operationState()).toBeNull();
      await expect(t.repo.runner.run('am', [patch])).rejects.toBeInstanceOf(GitError);
      await t.repo.abort({ kind: 'applyingPatches' });
      expect(await t.repo.operationState()).toBeNull();
    }));

  it('bisect: nhận ra rồi `bisect reset`; continue/skip của merge/bisect không làm gì', () =>
    withTestRepo(async (t) => {
      await commitFile(t, 'a.txt', '1\n', 'c1');
      await commitFile(t, 'a.txt', '2\n', 'c2');
      await t.repo.runner.run('bisect', ['start']);
      expect(await t.repo.operationState()).toEqual({ kind: 'bisecting' });
      await t.repo.continueOperation({ kind: 'bisecting' });
      await t.repo.skip({ kind: 'bisecting' });
      await t.repo.skip({ kind: 'merging' });
      expect(await t.repo.operationState()).toEqual({ kind: 'bisecting' });
      await t.repo.abort({ kind: 'bisecting' });
      expect(await t.repo.operationState()).toBeNull();
      // `bisect run` (runs an arbitrary command) is blocked by policy.
      await expect(t.repo.runner.run('bisect', ['run', 'sh', '-c', 'id'])).rejects.toMatchObject({
        code: 'policy',
      });
    }));

  it('pendingCommitMessage bỏ dòng chú thích; không có thao tác dở thì null', () =>
    withTestRepo(async (t) => {
      await diverge(t);
      expect(await t.repo.pendingCommitMessage()).toBeNull();
      await expect(t.repo.merge('other')).rejects.toBeInstanceOf(GitError);
      const message = await t.repo.pendingCommitMessage();
      expect(message?.startsWith("Merge branch 'other'")).toBe(true);
      expect(message).not.toMatch(/^#/m);
      await t.repo.abort({ kind: 'merging' });
      expect(await t.repo.pendingCommitMessage()).toBeNull();
    }));
});

describe('merge / cherry-pick / revert / reset', () => {
  async function twoBranches(t: TestRepo): Promise<void> {
    await commitFile(t, 'base.txt', 'base\n', 'base');
    await t.repo.createBranch('feature', null, true);
    await commitFile(t, 'f.txt', 'f\n', 'feature');
    await t.repo.switchTo('main');
  }

  it('kiểu merge: automatic (fast-forward), noFastForward, fastForwardOnly, squash', () =>
    withTestRepo(async (t) => {
      await twoBranches(t);
      await t.repo.merge('feature');
      let log = await t.repo.log({ limit: 10, order: 'topo', includeHead: true });
      expect(log.map((commit) => commit.subject)).toEqual(['feature', 'base']);

      await t.repo.reset('HEAD~1', 'hard');
      await t.repo.merge('feature', 'noFastForward');
      log = await t.repo.log({ limit: 10, order: 'topo', includeHead: true });
      expect(log[0] && isMergeCommit(log[0])).toBe(true);

      await t.repo.reset('HEAD~1', 'hard');
      await t.repo.merge('feature', 'fastForwardOnly');
      expect(await t.read('f.txt')).toBe('f\n');

      await t.repo.reset('HEAD~1', 'hard');
      await commitFile(t, 'm.txt', 'm\n', 'main riêng');
      const error = await t.repo.merge('feature', 'fastForwardOnly').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GitError);
      expect((error as GitError).contains('fast-forward')).toBe(true);

      await t.repo.merge('feature', 'squash');
      expect(await t.read('f.txt')).toBe('f\n');
      const staged = (await t.repo.status()).staged.map((change) => change.path);
      expect(staged).toEqual(['f.txt']);
      expect(await t.repo.pendingCommitMessage()).toContain('Squashed commit');
      await t.repo.commit('đã squash');
      expect((await t.repo.log({ limit: 1, order: 'date', includeHead: true }))[0]?.parents).toHaveLength(1);
    }));

  it('mergeBase: điểm tách của nhánh khỏi nhánh đích, null khi không có lịch sử chung', () =>
    withTestRepo(async (t) => {
      await twoBranches(t);
      const base = await t.repo.resolveCommit('main');
      await commitFile(t, 'm.txt', 'm\n', 'main đi tiếp');
      expect(await t.repo.mergeBase('main', 'feature')).toBe(base);
      expect(await t.repo.mergeBase('feature', 'main')).toBe(base);
      expect(await t.repo.mergeBase('feature', 'feature')).toBe(await t.repo.resolveCommit('feature'));

      t.git('checkout', '-q', '--orphan', 'lonely');
      await commitFile(t, 'x.txt', 'x\n', 'gốc khác');
      expect(await t.repo.mergeBase('main', 'lonely')).toBeNull();
    }));

  it('cherry-pick và revert thành công', () =>
    withTestRepo(async (t) => {
      await twoBranches(t);
      const featureTip = await t.repo.resolveCommit('feature');
      const baseSha = await t.repo.resolveCommit('main');
      await t.repo.cherryPick(featureTip);
      expect(await t.read('f.txt')).toBe('f\n');
      const picked = await t.repo.log({ limit: 1, order: 'date', includeHead: true });
      expect(picked[0]?.subject).toBe('feature');
      expect(picked[0]?.parents).toEqual([baseSha]);
      await t.repo.revert(picked[0]?.id ?? '');
      expect(await t.exists('f.txt')).toBe(false);
      expect((await t.repo.log({ limit: 1, order: 'date', includeHead: true }))[0]?.subject).toMatch(
        /^Revert "feature"/,
      );
    }));

  it('revert chưa commit: chỉ stage thay đổi đảo ngược, repo ở trạng thái "Đang revert"', () =>
    withTestRepo(async (t) => {
      await twoBranches(t);
      await t.repo.merge('feature');
      const tip = await t.repo.resolveCommit('HEAD');
      await t.repo.revert(tip, null, false);
      expect(await t.repo.resolveCommit('HEAD')).toBe(tip);
      expect(await t.exists('f.txt')).toBe(false);
      expect((await t.repo.status()).staged.map((change) => [change.path, change.kind])).toEqual([
        ['f.txt', 'deleted'],
      ]);
      expect(await t.repo.operationState()).toEqual({ kind: 'reverting' });
      expect(await t.repo.pendingCommitMessage()).toMatch(/^Revert "feature"/);
      await t.repo.abort({ kind: 'reverting' });
      expect(await t.repo.operationState()).toBeNull();
      expect(await t.read('f.txt')).toBe('f\n');
    }));

  it('commit merge: phải nêu cha (mainline) cho cherry-pick và revert', () =>
    withTestRepo(async (t) => {
      await twoBranches(t);
      await t.repo.createBranch('target', 'main', false);
      await t.repo.merge('feature', 'noFastForward');
      const mergeCommit = await t.repo.resolveCommit('HEAD');
      await t.repo.switchTo('target');

      const withoutMainline = await t.repo.cherryPick(mergeCommit).catch((e: unknown) => e);
      expect(withoutMainline).toBeInstanceOf(GitError);
      expect((withoutMainline as GitError).contains('is a merge but no -m option')).toBe(true);
      await t.repo.cherryPick(mergeCommit, 1);
      expect(await t.read('f.txt')).toBe('f\n');
      await t.repo.revert(await t.repo.resolveCommit('HEAD'));
      expect(await t.exists('f.txt')).toBe(false);
      await expect(t.repo.cherryPick(mergeCommit, 0)).rejects.toBeInstanceOf(RangeError);
      await expect(t.repo.revert(mergeCommit, 1.5)).rejects.toBeInstanceOf(RangeError);
    }));

  it('reset soft/mixed/hard, resetKeepingLocalChanges, softReset, hardReset', () =>
    withTestRepo(async (t) => {
      await t.write('keep.txt', 'k\n');
      const c1 = await commitFile(t, 'a.txt', '1\n', 'c1');
      await commitFile(t, 'a.txt', '2\n', 'c2');

      await t.repo.reset(c1, 'soft');
      expect((await t.repo.status()).staged).toEqual([{ path: 'a.txt', kind: 'modified' }]);
      await t.repo.commit('c2 lại');
      await t.repo.reset(c1, 'mixed');
      expect((await t.repo.status()).staged).toEqual([]);
      expect((await t.repo.status()).unstaged).toEqual([{ path: 'a.txt', kind: 'modified' }]);
      expect(await t.read('a.txt')).toBe('2\n');
      await t.repo.hardReset();
      expect(await t.read('a.txt')).toBe('1\n');

      // `reset --merge` keeps UNSTAGED changes in other files (used to undo a pull).
      await commitFile(t, 'a.txt', '3\n', 'c3');
      await t.write('keep.txt', 'đang sửa\n');
      await t.repo.resetKeepingLocalChanges(c1);
      expect(await t.read('a.txt')).toBe('1\n');
      expect(await t.read('keep.txt')).toBe('đang sửa\n');
      expect((await t.repo.status()).unstaged).toEqual([{ path: 'keep.txt', kind: 'modified' }]);
      expect(await t.repo.resolveCommit('HEAD')).toBe(c1);

      await commitFile(t, 'b.txt', 'b\n', 'thêm b');
      await t.repo.softReset('HEAD~1');
      expect((await t.repo.status()).staged.map((change) => change.path).sort()).toEqual([
        'b.txt',
        'keep.txt',
      ]);
      await t.repo.hardReset('HEAD');
      expect(isStatusClean(await t.repo.status())).toBe(true);
    }));

  it('undoInitialCommit đưa nhánh về chưa có commit nhưng giữ index', () =>
    withTestRepo(async (t) => {
      await commitFile(t, 'a.txt', '1\n', 'đầu tiên');
      await t.repo.undoInitialCommit();
      const status = await t.repo.status();
      expect(isUnbornHead(status.head)).toBe(true);
      expect(status.staged).toEqual([{ path: 'a.txt', kind: 'added' }]);
      await t.repo.unstageAll(false);
      expect((await t.repo.status()).staged).toEqual([]);
      expect((await t.repo.status()).unstaged).toEqual([{ path: 'a.txt', kind: 'untracked' }]);
    }));

  it('unstage / unstageAll khi đã có HEAD; stage/discard danh sách rỗng là no-op', () =>
    withTestRepo(async (t) => {
      await commitFile(t, 'a.txt', '1\n', 'init');
      await t.write('a.txt', '2\n');
      await t.write('b.txt', 'mới\n');
      await t.repo.stageAll();
      expect((await t.repo.status()).staged).toHaveLength(2);
      await t.repo.unstage(['a.txt'], true);
      expect((await t.repo.status()).staged).toEqual([{ path: 'b.txt', kind: 'added' }]);
      await t.repo.unstageAll(true);
      expect((await t.repo.status()).staged).toEqual([]);
      await t.repo.stage([]);
      await t.repo.unstage([], true);
      await t.repo.discard([]);
      await t.repo.restoreWorkingFiles('HEAD', []);
      await t.repo.markResolved([]);
      expect(await t.read('a.txt')).toBe('2\n');
    }));

  it('xung đột "bên kia đã xoá / bên này thêm": resolveConflict chọn xoá file hoặc giữ file', () =>
    withTestRepo(async (t) => {
      await commitFile(t, 'a.txt', 'x\n', 'base');
      await t.repo.createBranch('xoa', null, true);
      t.git('rm', '-q', 'a.txt');
      await t.repo.commit('xoá a');
      await t.repo.switchTo('main');
      await commitFile(t, 'a.txt', 'sửa\n', 'sửa a');

      await expect(t.repo.merge('xoa')).rejects.toBeInstanceOf(GitError);
      expect((await t.repo.status()).conflicts).toEqual([{ path: 'a.txt', kind: 'deletedByThem' }]);
      await t.repo.resolveConflict('a.txt', 'deletedByThem', false);
      expect(await t.exists('a.txt')).toBe(false);
      await t.repo.abort({ kind: 'merging' });

      await expect(t.repo.merge('xoa')).rejects.toBeInstanceOf(GitError);
      await t.repo.resolveConflict('a.txt', 'deletedByThem', true);
      expect(await t.read('a.txt')).toBe('sửa\n');
      expect((await t.repo.status()).conflicts).toEqual([]);
    }));
});

describe('nhánh, stash, log, lịch sử file', () => {
  it('switchDetached, createBranch (checkout/start point), deleteBranch cần force với nhánh chưa merge', () =>
    withTestRepo(async (t) => {
      const c1 = await commitFile(t, 'a.txt', '1\n', 'c1');
      await commitFile(t, 'a.txt', '2\n', 'c2');
      await t.repo.switchDetached(c1);
      const detached = (await t.repo.status()).head;
      expect(isDetachedHead(detached)).toBe(true);
      expect(headOid(detached)).toBe(c1);
      await t.repo.switchTo('main');
      expect(headBranchName((await t.repo.status()).head)).toBe('main');

      await t.repo.createBranch('tu-c1', c1, true);
      expect(headOid((await t.repo.status()).head)).toBe(c1);
      await commitFile(t, 'b.txt', 'b\n', 'chỉ có trên tu-c1');
      await t.repo.switchTo('main');
      const error = await t.repo.deleteBranch('tu-c1', false).catch((e: unknown) => e);
      expect((error as GitError).contains('not fully merged')).toBe(true);
      await t.repo.deleteBranch('tu-c1', true);
      expect((await t.repo.refs()).map(refName)).toEqual(['main']);
    }));

  it('stash: tên mặc định, không untracked, apply --index, pop, drop', () =>
    withTestRepo(async (t) => {
      await commitFile(t, 'a.txt', '1\n', 'Sửa lỗi đăng nhập');
      await t.write('a.txt', '2\n');
      await t.repo.stage(['a.txt']);
      await t.write('moi.txt', 'chưa track\n');
      await t.repo.stashPush(null, false);
      expect(await t.exists('moi.txt')).toBe(true);
      const [stash] = await t.repo.stashes();
      if (!stash) throw new Error('phải có stash');
      expect(stashDisplayMessage(stash)).toBe('WIP trên main: Sửa lỗi đăng nhập');
      expect(stashBranchName(stash)).toBe('main');
      expect(stash.parents).toHaveLength(2);
      expect((await t.repo.status()).stashCount).toBe(1);

      await t.repo.stashApply(stash.selector, true);
      expect((await t.repo.status()).staged).toEqual([{ path: 'a.txt', kind: 'modified' }]);
      await t.repo.hardReset();
      await t.repo.stashApply(stash.selector);
      expect((await t.repo.status()).staged).toEqual([]);
      expect((await t.repo.status()).unstaged).toContainEqual({ path: 'a.txt', kind: 'modified' });
      await t.repo.hardReset();
      await t.repo.stashPop(stash.selector);
      expect(await t.repo.stashes()).toEqual([]);
      expect(await t.read('a.txt')).toBe('2\n');
      await t.repo.hardReset();

      await t.write('a.txt', '3\n');
      await t.repo.stashPush('', false);
      await t.repo.stashDrop('stash@{0}');
      expect(await t.repo.stashes()).toEqual([]);
    }));

  it('logBytes: includeRemotes/includeTags/includeHead và thứ tự topo/date', () =>
    withTestRepo(async (t) => {
      const c1 = await commitFile(t, 'a.txt', '1\n', 'c1');
      // A commit only reachable from a detached HEAD, then tag a commit that belongs to no branch.
      await t.repo.switchDetached(c1);
      const detachedTip = await commitFile(t, 'd.txt', 'd\n', 'trên detached');
      await t.repo.createTag('chi-tag', detachedTip, null);
      await t.repo.switchTo('main');
      const subjects = async (options: { includeHead: boolean; includeTags?: boolean }) =>
        (await t.repo.log({ limit: 10, order: 'date', ...options })).map((commit) => commit.subject);
      expect(await subjects({ includeHead: false })).toEqual(['trên detached', 'c1']);
      expect(await subjects({ includeHead: false, includeTags: false })).toEqual(['c1']);
      await t.repo.switchDetached(detachedTip);
      expect(await subjects({ includeHead: true, includeTags: false })).toEqual(['trên detached', 'c1']);
      expect(await t.repo.log({ limit: 1, order: 'topo', includeHead: true })).toHaveLength(1);
      expect(await t.repo.log({ limit: 0, order: 'topo', includeHead: true })).toHaveLength(1);
      expect(await t.repo.log({ limit: 5.9, order: 'topo', includeHead: true })).toHaveLength(2);
    }));

  it('fileHistory theo dấu rename, commitDetails, changedFiles của commit gốc/merge', () =>
    withTestRepo(async (t) => {
      await commitFile(t, 'cũ.txt', 'nội dung đủ dài để git nhận ra rename\nthêm dòng\nvà dòng nữa\n', 'tạo');
      t.git('mv', 'cũ.txt', 'mới.txt');
      await t.repo.commit('đổi tên');
      await commitFile(
        t,
        'mới.txt',
        'nội dung đủ dài để git nhận ra rename\nthêm dòng\nvà dòng nữa\nsửa\n',
        'sửa',
      );
      const history = await t.repo.fileHistory('mới.txt');
      expect(history.map((entry) => entry.commit.subject)).toEqual(['sửa', 'đổi tên', 'tạo']);
      expect(history.map((entry) => entry.change)).toEqual([
        { path: 'mới.txt', kind: 'modified' },
        { path: 'mới.txt', oldPath: 'cũ.txt', kind: 'renamed' },
        { path: 'cũ.txt', kind: 'added' },
      ]);
      expect((await t.repo.fileHistory('mới.txt', 1)).map((entry) => entry.commit.subject)).toEqual(['sửa']);

      const log = await t.repo.log({ limit: 10, order: 'topo', includeHead: true });
      const renameCommit = log.find((commit) => commit.subject === 'đổi tên');
      if (!renameCommit) throw new Error('thiếu commit đổi tên');
      const details = await t.repo.commitDetails(renameCommit);
      expect(details.message.trim()).toBe('đổi tên');
      expect(details.files).toEqual([{ path: 'mới.txt', oldPath: 'cũ.txt', kind: 'renamed' }]);
      const root = log.find((commit) => commit.subject === 'tạo');
      expect((await t.repo.commitDetails(root as Commit)).files).toEqual([{ path: 'cũ.txt', kind: 'added' }]);
    }));
});

describe('blame', () => {
  it('quy từng dòng về commit (cả tại một commit cũ), dòng chưa commit mang sha toàn số 0', () =>
    withTestRepo(async (t) => {
      const first = await commitFile(t, 'a.txt', 'một\nhai\n', 'tạo a');
      const second = await commitFile(t, 'a.txt', 'một\nhai sửa\nba\n', 'sửa a');

      const blame = await t.repo.blame('a.txt');
      expect(blame.lines.map((line) => [line.text, line.sha, line.startsGroup])).toEqual([
        ['một', first, true],
        ['hai sửa', second, true],
        ['ba', second, false],
      ]);
      expect(blame.commits.get(first)?.summary).toBe('tạo a');

      // At the old commit: only that commit's content.
      expect((await t.repo.blame('a.txt', first)).lines.map((line) => line.text)).toEqual(['một', 'hai']);

      await t.write('a.txt', 'một\nhai sửa\nba\nbốn chưa commit\n');
      const working = await t.repo.blame('a.txt');
      const last = working.lines.at(-1);
      expect(last?.text).toBe('bốn chưa commit');
      expect(isUncommittedBlame(last?.sha ?? '')).toBe(true);
    }));
});

describe('lịch sử lớn qua NodeExec', () => {
  /** fast-import stream: `count` linear commits on main, with a side branch merged in every 100 commits. */
  function fastImportStream(count: number): Uint8Array {
    const parts: string[] = [];
    let mark = 0;
    const commit = (ref: string, parents: number[], subject: string, time: number) => {
      mark += 1;
      const data = new TextEncoder().encode(subject);
      parts.push(
        `commit ${ref}\nmark :${mark}\nauthor Nhánh Test <t@x> ${time} +0700\ncommitter Nhánh Test <t@x> ${time} +0700\ndata ${data.length}\n${subject}\n`,
      );
      if (parents[0] !== undefined) parts.push(`from :${parents[0]}\n`);
      for (const extra of parents.slice(1)) parts.push(`merge :${extra}\n`);
      parts.push(`M 644 inline f.txt\ndata ${String(mark).length}\n${mark}\n\n`);
      return mark;
    };
    let main = commit('refs/heads/main', [], 'Khởi tạo', 1_600_000_000);
    for (let n = 1; n < count; n++) {
      if (n % 100 === 0) {
        const side = commit('refs/heads/phu', [main], `nhánh phụ ${n}`, 1_600_000_000 + n * 60);
        main = commit('refs/heads/main', [main, side], `Merge phụ ${n}`, 1_600_000_000 + n * 60 + 1);
      } else {
        main = commit('refs/heads/main', [main], `Sửa lỗi số ${n}`, 1_600_000_000 + n * 60);
      }
    }
    return new TextEncoder().encode(parts.join(''));
  }

  it('đọc log vài nghìn commit (nhiều MB stdout) đủ và đúng thứ tự, xếp làn đủ hàng', () =>
    withTestRepo(async (t) => {
      const stream = fastImportStream(4000);
      rawGit(t.root, ['fast-import', '--quiet'], t.config, stream);
      const head = await t.repo.resolveCommit('main');
      const bytes = await t.repo.logBytes({ limit: 100_000, order: 'date', includeHead: true });
      const history = buildHistory(bytes, { limit: 100_000, headOid: head, showWorkingTree: true });
      // 4000 commits on main, of which 39 rounds (n divisible by 100) add one side-branch commit.
      expect(history.loadedCount).toBe(4000 + 39);
      expect(history.mayHaveMore).toBe(false);
      expect(history.commits[0] && isWorkingTreeCommit(history.commits[0])).toBe(true);
      expect(history.rows).toHaveLength(history.commits.length);
      expect(history.commits[1]?.id).toBe(head);
      expect(history.commits.slice(1).filter(isMergeCommit)).toHaveLength(39);
      expect(Math.max(...history.rows.map((row) => row.width))).toBeLessThanOrEqual(3);

      const limited = await t.repo.log({ limit: 50, order: 'topo', includeHead: true });
      expect(limited).toHaveLength(50);
      expect(buildHistory(limited, { limit: 50, headOid: head, showWorkingTree: false }).mayHaveMore).toBe(
        true,
      );
    }));
});

describe('isValidRefName: bản TS khớp `git check-ref-format`', () => {
  const corpus = [
    'main',
    'feature/x',
    'a/b/c',
    'phát-triển',
    'é/ü',
    'HEAD',
    'head',
    '@',
    '@x',
    'x@',
    '@{-1}',
    'a@{b',
    '-x',
    '-',
    '--x',
    'a//b',
    '/a',
    'a/',
    'a/.b',
    '.a',
    'a.',
    'a..b',
    'a.lock',
    'a/b.lock',
    'a.lock/b',
    'a/.lock',
    'a b',
    'a~b',
    'a^b',
    'a:b',
    'a?b',
    'a*b',
    'a[b',
    'a\\b',
    'a\u0007b',
    'a\u007fb',
    'v1.0.0',
    'release-2026.10',
    'x.y.z',
    'a.b/c.d',
    'a/b.',
    '++',
    'a+b',
    'a=b',
    'a,b',
    'a#b',
    'a!b',
    '',
    ' ',
    'a\tb',
    'a{b',
    'a}b',
    'ĐĂ/ÂÔ',
  ];

  it('khớp git thật trên bộ tên đại diện, cho cả nhánh lẫn tag', () =>
    withTestRepo(async (t) => {
      for (const name of corpus) {
        for (const branch of [true, false]) {
          const expected = await t.repo.isValidRefName(name, branch);
          expect(isValidRefName(name, branch), `${JSON.stringify(name)} branch=${branch}`).toBe(expected);
        }
      }
    }));

  it('khớp git thật trên tên ngẫu nhiên ghép từ ký tự đặc biệt', () =>
    withTestRepo(async (t) => {
      const alphabet = [
        'a',
        'b',
        '.',
        '/',
        '-',
        '@',
        '{',
        'lock',
        '.lock',
        '..',
        '~',
        '^',
        ':',
        '*',
        '?',
        '[',
        '\\',
        '_',
        '1',
        'é',
      ];
      let state = 12345;
      const random = () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
      };
      for (let i = 0; i < 70; i++) {
        const length = 1 + Math.floor(random() * 5);
        const name = Array.from(
          { length },
          () => alphabet[Math.floor(random() * alphabet.length)] ?? 'a',
        ).join('');
        const expected = await t.repo.isValidRefName(name, true);
        expect(isValidRefName(name, true), JSON.stringify(name)).toBe(expected);
      }
    }));

  it('tag bắt đầu bằng "-" bị từ chối ở cả hai bản (khác git có chủ ý)', () =>
    withTestRepo(async (t) => {
      expect(isValidRefName('-x', false)).toBe(false);
      expect(await t.repo.isValidRefName('-x', false)).toBe(false);
    }));
});

describe('remote cục bộ: pull 3 chế độ, tag, upstream, fast-forward', () => {
  /** A bare origin plus two clones: `a` (the repo under test) and `b` (somebody else). */
  async function setup(parent: string): Promise<{ bare: string; a: TestRepo; b: TestRepo }> {
    const config = isolatedConfig();
    const bare = await createBareRemote(parent, config);
    return {
      bare,
      a: await cloneTestRepo(parent, bare, 'a', config),
      b: await cloneTestRepo(parent, bare, 'b', config),
    };
  }

  async function pushFrom(b: TestRepo, path: string, content: string, message: string): Promise<void> {
    await b.write(path, content);
    await b.commitAll(message);
    b.git('push', 'origin', 'main');
  }

  it('fetchRefspec: một lần fetch nhiều refspec (nhánh nguồn + nhánh đích của một PR)', () =>
    withTempDir(async (parent) => {
      const { a, b } = await setup(parent);
      b.git('checkout', '-q', '-b', 'feat');
      await b.write('feat.txt', 'f\n');
      await b.commitAll('feat');
      b.git('push', 'origin', 'feat');
      b.git('checkout', '-q', 'main');
      await pushFrom(b, 'm.txt', 'm\n', 'main đi tiếp');

      await a.repo.fetchRefspec('origin', [
        '+refs/heads/feat:refs/remotes/origin/feat',
        '+refs/heads/main:refs/remotes/origin/main',
      ]);
      const feat = await a.repo.resolveCommit('refs/remotes/origin/feat');
      const main = await a.repo.resolveCommit('refs/remotes/origin/main');
      expect(await a.repo.mergeBase(main, feat)).toBe(await a.repo.resolveCommit('HEAD'));
      const files = await a.repo.changedFiles(feat, await a.repo.mergeBase(main, feat));
      expect(files.map((file) => file.path)).toEqual(['feat.txt']);
    }));

  it('pull merge: fast-forward khi không có commit local, merge commit khi đã tách', () =>
    withTempDir(async (parent) => {
      const { a, b } = await setup(parent);
      await pushFrom(b, 'b1.txt', '1\n', 'b1');
      await a.repo.pull('merge');
      expect(await a.exists('b1.txt')).toBe(true);
      expect(
        (await a.repo.log({ limit: 5, order: 'topo', includeHead: true })).map((commit) => commit.subject),
      ).toEqual(['b1', 'init']);

      await a.write('a-local.txt', 'a\n');
      await a.commitAll('a local');
      await pushFrom(b, 'b2.txt', '2\n', 'b2');
      await a.repo.pull('merge');
      const log = await a.repo.log({ limit: 5, order: 'topo', includeHead: true });
      expect(isMergeCommit(log[0] as Commit)).toBe(true);
      expect((await a.repo.status()).behind).toBe(0);
      expect((await a.repo.status()).ahead).toBe(2);
    }));

  it('pull fastForwardOnly: từ chối khi đã tách (thông báo của git), cho qua khi fast-forward được', () =>
    withTempDir(async (parent) => {
      const { a, b } = await setup(parent);
      await pushFrom(b, 'b1.txt', '1\n', 'b1');
      await a.repo.pull('fastForwardOnly');
      expect(await a.exists('b1.txt')).toBe(true);

      await a.write('a-local.txt', 'a\n');
      await a.commitAll('a local');
      await pushFrom(b, 'b2.txt', '2\n', 'b2');
      const head = await a.repo.resolveCommit('HEAD');
      const error = await a.repo.pull('fastForwardOnly').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GitError);
      expect((error as GitError).contains('Not possible to fast-forward')).toBe(true);
      expect(await a.repo.resolveCommit('HEAD')).toBe(head);
      // The fetch already ran, so remote-tracking is up to date (behind 1).
      expect((await a.repo.status()).behind).toBe(1);
    }));

  it('pull rebase: lịch sử thẳng, commit local nằm trên cùng; xung đột thì dừng ở trạng thái rebasing', () =>
    withTempDir(async (parent) => {
      const { a, b } = await setup(parent);
      await a.write('a-local.txt', 'a\n');
      await a.commitAll('a local');
      await pushFrom(b, 'b1.txt', '1\n', 'b1');
      await a.repo.pull('rebase');
      const log = await a.repo.log({ limit: 5, order: 'topo', includeHead: true });
      expect(log.map((commit) => commit.subject)).toEqual(['a local', 'b1', 'init']);
      expect(log.some(isMergeCommit)).toBe(false);
      const status = await a.repo.status();
      expect([status.ahead, status.behind]).toEqual([1, 0]);

      // Both edit a.txt → conflict while rebasing.
      await a.write('a.txt', 'của a\n');
      await a.commitAll('a sửa a.txt');
      await pushFrom(b, 'a.txt', 'của b\n', 'b sửa a.txt');
      await expect(a.repo.pull('rebase')).rejects.toBeInstanceOf(GitError);
      expect((await a.repo.operationState())?.kind).toBe('rebasing');
      await a.repo.abort({ kind: 'rebasing', step: null, total: null, headName: null });
      expect(await a.read('a.txt')).toBe('của a\n');
    }));

  it('pull khi nhánh chưa có upstream → lỗi git rõ ràng, không fetch, không đổi gì', () =>
    withTempDir(async (parent) => {
      const config = isolatedConfig();
      const bare = await createBareRemote(parent, config);
      const log = new CommandLog();
      const a = await cloneTestRepo(parent, bare, 'a', config, log);
      await a.repo.createBranch('khong-upstream', null, true);
      const head = await a.repo.resolveCommit('HEAD');
      const error = await a.repo.pull('merge').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GitError);
      expect((error as GitError).contains('no upstream')).toBe(true);
      expect(log.records.some((record) => record.args[0] === 'fetch')).toBe(false);
      expect(await a.repo.resolveCommit('HEAD')).toBe(head);
    }));

  it.skipIf(IS_WINDOWS)('huỷ pull trong lúc fetch: CancelledError, chưa merge/rebase gì', () =>
    withTempDir(async (parent) => {
      const hang = await createHangScript(parent, 'hang-ssh');
      const config = isolatedConfig({ GIT_SSH_COMMAND: hang.script });
      const dir = join(parent, 'r');
      await mkdir(dir);
      const { NodeGitHost } = await import('../src/node/index.ts');
      await new NodeGitHost(config).init(dir);
      rawGit(dir, ['config', 'user.name', 'T'], config);
      rawGit(dir, ['config', 'user.email', 't@x'], config);
      rawGit(dir, ['commit', '--allow-empty', '-m', 'init'], config);
      rawGit(dir, ['remote', 'add', 'origin', 'ssh://localhost/khong-ton-tai.git'], config);
      rawGit(dir, ['config', 'branch.main.remote', 'origin'], config);
      rawGit(dir, ['config', 'branch.main.merge', 'refs/heads/main'], config);
      rawGit(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD'], config);
      const repo = await openRepository(dir, config);
      const head = await repo.resolveCommit('HEAD');

      const controller = new AbortController();
      const pending = repo.pull('merge', { signal: controller.signal });
      const sshPid = await hang.pid();
      controller.abort();
      const error = await pending.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CancelledError);
      expect((error as CancelledError).exitCode).toBe(143);
      expect(await repo.resolveCommit('HEAD')).toBe(head);
      expect(await repo.operationState()).toBeNull();
      await waitFor(() => !isProcessAlive(sshPid), 5000);
    }),
  );

  it('fetch theo remote cụ thể và hồ sơ background; tag: push, push tất cả, xoá trên remote', () =>
    withTempDir(async (parent) => {
      const { bare, a, b } = await setup(parent);
      await pushFrom(b, 'b1.txt', '1\n', 'b1');
      // With a `signal` that was never triggered: the command runs in its own process group and still finishes normally.
      await a.repo.fetch({ remote: 'origin', profile: 'background', signal: new AbortController().signal });
      expect((await a.repo.status()).behind).toBe(1);

      const head = await a.repo.resolveCommit('HEAD');
      await a.repo.createTag('v1', head, 'bản 1');
      await a.repo.createTag('v2', head, null);
      await a.repo.pushTag('origin', 'v1');
      expect(rawGit(bare, ['tag', '--list'])).toBe('v1\n');
      await a.repo.pushAllTags('origin');
      expect(rawGit(bare, ['tag', '--list']).trim().split('\n')).toEqual(['v1', 'v2']);
      await a.repo.deleteRemoteTag('origin', 'v1');
      expect(rawGit(bare, ['tag', '--list'])).toBe('v2\n');
    }));

  it('nhánh remote: checkoutTracking, setUpstream/unsetUpstream, fastForward, pushCommit khôi phục nhánh đã xoá', () =>
    withTempDir(async (parent) => {
      const { bare, a, b } = await setup(parent);
      b.git('switch', '-c', 'dev');
      await b.write('dev.txt', '1\n');
      await b.commitAll('dev 1');
      b.git('push', 'origin', 'dev');
      await a.repo.fetch({});
      await a.repo.checkoutTracking('origin/dev', 'dev');
      expect(headBranchName((await a.repo.status()).head)).toBe('dev');
      expect((await a.repo.refs()).find((ref) => refName(ref) === 'dev')?.upstream).toBe('origin/dev');

      await a.repo.unsetUpstream('dev');
      expect((await a.repo.refs()).find((ref) => refName(ref) === 'dev')?.upstream).toBeNull();
      await a.repo.setUpstream('dev', 'origin/dev');
      expect((await a.repo.refs()).find((ref) => refName(ref) === 'dev')?.upstream).toBe('origin/dev');

      // dev on `a` lags behind origin/dev; while on main, fast-forward the dev branch (which is not the current branch).
      await a.repo.switchTo('main');
      await b.write('dev.txt', '2\n');
      await b.commitAll('dev 2');
      b.git('push', 'origin', 'dev');
      await a.repo.fetch({ prune: true });
      const before = await a.repo.resolveCommit('dev');
      await a.repo.fastForward('dev', 'origin/dev');
      expect(await a.repo.resolveCommit('dev')).toBe(await a.repo.resolveCommit('origin/dev'));
      expect(await a.repo.resolveCommit('dev')).not.toBe(before);

      // Delete a remote branch, then restore it to exactly the old commit.
      const tip = await a.repo.resolveCommit('origin/dev');
      await a.repo.deleteRemoteBranch('origin', 'dev');
      expect(rawGit(bare, ['branch', '--list', 'dev'])).toBe('');
      await a.repo.pushCommit(tip, 'origin', 'dev');
      expect(rawGit(bare, ['rev-parse', 'dev']).trim()).toBe(tip);

      // The remote deleted a branch → upstream reports "gone" after fetch --prune.
      await b.repo.fetch({});
      b.git('push', 'origin', '--delete', 'dev');
      await a.repo.fetch({ prune: true });
      expect((await a.repo.refs()).find((ref) => refName(ref) === 'dev')?.upstreamGone).toBe(true);
    }));

  it('lệnh mạng thất bại (remote không tồn tại) → GitError, không treo', () =>
    withTempDir(async (parent) => {
      const { a } = await setup(parent);
      await a.repo.addRemote('hong', join(parent, 'khong-ton-tai.git'));
      const error = await a.repo.fetch({ remote: 'hong' }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GitError);
      expect((error as GitError).exitCode).toBe(128);
      await expect(
        a.repo.push({ remote: 'hong', localBranch: 'main', remoteBranch: 'main' }),
      ).rejects.toBeInstanceOf(GitError);
      expect(await a.repo.isValidRefName('main', true)).toBe(true);
    }));

  it('mở repo qua RepositoryError khi tên không hợp lệ không làm hỏng trạng thái', () =>
    withTempDir(async (parent) => {
      const { a } = await setup(parent);
      await expect(a.repo.switchTo('--detach')).rejects.toBeInstanceOf(RepositoryError);
      expect(headBranchName((await a.repo.status()).head)).toBe('main');
    }));
});
