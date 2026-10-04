// Port RepositoryTests.swift: git thật trong thư mục tạm, cấu hình cô lập. Bốn test staging theo dòng/hunk cần
// PatchBuilder nằm ở `repository.staging.test.ts` (it.todo); phần diff/patch kiểm bằng byte thô thay vì parse.

import { chmod, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AdapterError,
  CommandLog,
  GitError,
  RepositoryError,
  buildHistory,
  headOid,
  isMergeCommit,
  isStatusClean,
  isWorkingTreeCommit,
  isAnnotatedTag,
  refName,
  sha256Hex,
  stashDisplayMessage,
} from '../src/git/index.ts';
import { openRepository } from '../src/node/index.ts';
import {
  IS_WINDOWS,
  cloneTestRepo,
  createBareRemote,
  isolatedConfig,
  numberedLines,
  rawGit,
  withTempDir,
  withTestRepo,
  writeExecutableScript,
} from './helpers/test-repo.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const text = (bytes: Uint8Array) => dec.decode(bytes);

describe('Repository (git thật trong thư mục tạm)', () => {
  it('unbornRepositoryHasEmptyHistory', () =>
    withTestRepo(async (t) => {
      const status = await t.repo.status();
      expect(status.head).toEqual({ kind: 'branch', name: 'main', oid: null });
      const bytes = await t.repo.logBytes({ limit: 100, order: 'date', includeHead: false });
      expect(bytes).toHaveLength(0);
      expect(await t.repo.log({ limit: 100, order: 'date', includeHead: false })).toEqual([]);
      // `HEAD` chưa trỏ tới commit nào: git báo lỗi, logBytes quy về lịch sử rỗng.
      expect(await t.repo.logBytes({ limit: 100, order: 'date', includeHead: true })).toHaveLength(0);
      const history = buildHistory(bytes, {
        limit: 100,
        headOid: headOid(status.head),
        showWorkingTree: true,
      });
      expect(history.commits).toHaveLength(1);
      expect(history.commits[0] && isWorkingTreeCommit(history.commits[0])).toBe(true);
      expect(await t.repo.stashes()).toEqual([]);
      expect(await t.repo.refs()).toEqual([]);
    }));

  it('stageCommitAndReadHistory', () =>
    withTestRepo(async (t) => {
      await t.write('a.txt', 'xin chào\n');
      await t.write('thư mục/b c.txt', 'b\n');

      let status = await t.repo.status();
      expect(status.unstaged.map((change) => change.path).sort()).toEqual(['a.txt', 'thư mục/b c.txt']);
      expect(status.unstaged.every((change) => change.kind === 'untracked')).toBe(true);

      await t.repo.stage(['a.txt']);
      status = await t.repo.status();
      expect(status.staged).toEqual([{ path: 'a.txt', kind: 'added' }]);

      await t.repo.unstage(['a.txt'], false);
      status = await t.repo.status();
      expect(status.staged).toEqual([]);

      await t.repo.stageAll();
      await t.repo.commit('Commit đầu tiên\n\nMô tả chi tiết');
      status = await t.repo.status();
      expect(isStatusClean(status)).toBe(true);
      const head = headOid(status.head);
      if (head === null) throw new Error('HEAD phải có commit');

      const refs = await t.repo.refs();
      expect(refs).toHaveLength(1);
      expect(refs[0]).toMatchObject({ fullName: 'refs/heads/main', isHead: true, target: head });

      const log = await t.repo.log({ limit: 10, order: 'topo', includeHead: true });
      expect(log).toHaveLength(1);
      expect(log[0]?.subject).toBe('Commit đầu tiên');
      expect(log[0]?.authorName).toBe('Nhánh Test');
      expect(await t.repo.commitMessage(head)).toContain('Mô tả chi tiết');
      const files = await t.repo.changedFiles(head, null);
      expect(files.map((file) => file.path).sort()).toEqual(['a.txt', 'thư mục/b c.txt']);
      const diff = text(await t.repo.commitDiffBytes(head, null, { path: 'a.txt', kind: 'added' }));
      expect(diff).toContain('new file mode');
      expect(diff).toContain('+xin chào');

      // Amend đổi message.
      await t.repo.commit('Commit đã sửa', { amend: true });
      const amended = await t.repo.log({ limit: 10, order: 'date', includeHead: true });
      expect(amended).toHaveLength(1);
      expect(amended[0]?.subject).toBe('Commit đã sửa');
    }));

  it('untrackedAndStagedDiffs', () =>
    withTestRepo(async (t) => {
      await t.write('a.txt', '1\n2\n3\n');
      await t.commitAll('init');
      await t.write('new.txt', 'hello\nworld\n');
      const untracked = text(
        await t.repo.workingDiffBytes({ path: 'new.txt', kind: 'untracked' }, 'untracked'),
      );
      expect(untracked).toContain('new file mode');
      expect(untracked).toContain('+hello\n+world\n');

      await t.write('a.txt', '1\nhai\n3\n');
      await t.repo.stage(['a.txt']);
      const staged = text(await t.repo.workingDiffBytes({ path: 'a.txt', kind: 'modified' }, 'staged'));
      expect(staged).toContain('-2\n+hai\n');
      const unstaged = await t.repo.workingDiffBytes({ path: 'a.txt', kind: 'modified' }, 'unstaged');
      expect(unstaged).toHaveLength(0);
    }));

  it('applyPatch: áp byte diff vào index, ngược để unstage, ngược vào working tree để huỷ', () =>
    withTestRepo(async (t) => {
      await t.write('f.txt', '1\n2\n3\n');
      await t.commitAll('init');
      await t.write('f.txt', '1\nhai\n3\n');
      const change = { path: 'f.txt', kind: 'modified' } as const;

      await t.repo.applyPatch(await t.repo.workingDiffBytes(change, 'unstaged'), {
        cached: true,
        reverse: false,
      });
      expect(text(await t.repo.blob(':f.txt'))).toBe('1\nhai\n3\n');
      expect((await t.repo.workingDiffBytes(change, 'unstaged')).length).toBe(0);

      await t.repo.applyPatch(await t.repo.workingDiffBytes(change, 'staged'), {
        cached: true,
        reverse: true,
      });
      expect(text(await t.repo.blob(':f.txt'))).toBe('1\n2\n3\n');
      expect(await t.read('f.txt')).toBe('1\nhai\n3\n');

      await t.repo.applyPatch(await t.repo.workingDiffBytes(change, 'unstaged'), {
        cached: false,
        reverse: true,
      });
      expect(await t.read('f.txt')).toBe('1\n2\n3\n');

      // Patch hỏng → GitError của `git apply`, không âm thầm bỏ qua.
      const error = await t.repo
        .applyPatch(enc.encode('đây không phải patch\n'), { cached: true, reverse: false })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GitError);
    }));

  it('applyPatch: patch -U0 bị git từ chối trừ khi bật unidiffZero (cả stage lẫn unstage)', () =>
    withTestRepo(async (t) => {
      await t.write('f.txt', '1\n2\n3\n4\n5\n');
      await t.commitAll('init');
      await t.write('f.txt', '1\n2\nBA\n4\n5\n');
      const change = { path: 'f.txt', kind: 'modified' } as const;

      const patch = await t.repo.workingDiffBytes(change, 'unstaged', 0);
      expect(text(patch)).toContain('@@ -3 +3 @@');
      const refused = await t.repo
        .applyPatch(patch, { cached: true, reverse: false })
        .catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(GitError);
      expect(text(await t.repo.blob(':f.txt'))).toBe('1\n2\n3\n4\n5\n');

      await t.repo.applyPatch(patch, { cached: true, reverse: false, unidiffZero: true });
      expect(text(await t.repo.blob(':f.txt'))).toBe('1\n2\nBA\n4\n5\n');
      expect((await t.repo.workingDiffBytes(change, 'unstaged')).length).toBe(0);

      const staged = await t.repo.workingDiffBytes(change, 'staged', 0);
      await t.repo.applyPatch(staged, { cached: true, reverse: true, unidiffZero: true });
      expect(text(await t.repo.blob(':f.txt'))).toBe('1\n2\n3\n4\n5\n');
      // Huỷ khỏi working tree bằng patch -U0 ngược.
      const unstaged = await t.repo.workingDiffBytes(change, 'unstaged', 0);
      await t.repo.applyPatch(unstaged, { cached: false, reverse: true, unidiffZero: true });
      expect(await t.read('f.txt')).toBe('1\n2\n3\n4\n5\n');
    }));

  it('discardSnapshotAndUndo', () =>
    withTestRepo(async (t) => {
      await t.write('a.txt', 'gốc\n');
      await t.commitAll('init');
      await t.write('a.txt', 'đã sửa\n');
      await t.write('junk.txt', 'rác\n');

      const snapshot = await t.repo.snapshotChanges();
      if (snapshot === null) throw new Error('phải có snapshot');
      await t.repo.discard(['a.txt']);
      expect(await t.read('a.txt')).toBe('gốc\n');
      await t.repo.restoreWorkingFiles(snapshot, ['a.txt']);
      expect(await t.read('a.txt')).toBe('đã sửa\n');

      // Stash ghi lại commit lơ lửng → danh sách stash vẫn trống.
      expect(await t.repo.stashes()).toEqual([]);
      const token = await t.repo.trashUntracked(['junk.txt']);
      expect(await t.exists('junk.txt')).toBe(false);
      await t.repo.restoreTrash(token);
      expect(await t.read('junk.txt')).toBe('rác\n');

      // Không có thay đổi nào → không có snapshot.
      await t.repo.discard(['a.txt']);
      await t.repo.trashUntracked(['junk.txt']);
      expect(await t.repo.snapshotChanges()).toBeNull();
    }));

  it('mergeConflictLifecycle', () =>
    withTestRepo(async (t) => {
      await t.write('a.txt', 'dòng 1\ndòng 2\ndòng 3\n');
      await t.commitAll('init');

      await t.repo.createBranch('feature/x', null, true);
      await t.write('a.txt', 'dòng 1\nfeature\ndòng 3\n');
      await t.commitAll('feature change');

      await t.repo.switchTo('main');
      await t.write('a.txt', 'dòng 1\nmain\ndòng 3\n');
      await t.commitAll('main change');

      await expect(t.repo.merge('feature/x')).rejects.toBeInstanceOf(GitError);
      expect(await t.repo.operationState()).toEqual({ kind: 'merging' });
      const status = await t.repo.status();
      expect(status.conflicts).toEqual([{ path: 'a.txt', kind: 'bothModified' }]);
      expect((await t.repo.pendingCommitMessage())?.startsWith("Merge branch 'feature/x'")).toBe(true);

      const original = await t.repo.readWorkingFile('a.txt');
      if (original === null) throw new Error('file xung đột phải tồn tại');
      expect(text(original)).toContain('<<<<<<< HEAD\nmain\n=======\nfeature\n>>>>>>> feature/x\n');
      // Giải quyết: giữ cả hai (ours rồi theirs), ghi theo byte có CAS rồi đánh dấu đã giải quyết.
      await t.repo.writeWorkingFile(
        'a.txt',
        enc.encode('dòng 1\nmain\nfeature\ndòng 3\n'),
        await sha256Hex(original),
      );
      await t.repo.markResolved(['a.txt']);
      await t.repo.continueOperation({ kind: 'merging' });

      expect(await t.repo.operationState()).toBeNull();
      const log = await t.repo.log({ limit: 10, order: 'topo', includeHead: true });
      expect(log[0] && isMergeCommit(log[0])).toBe(true);
      expect(await t.read('a.txt')).toBe('dòng 1\nmain\nfeature\ndòng 3\n');
      const head = headOid((await t.repo.status()).head);
      const history = buildHistory(await t.repo.logBytes({ limit: 10, order: 'topo', includeHead: true }), {
        limit: 10,
        headOid: head,
        showWorkingTree: false,
      });
      expect(Math.max(...history.rows.map((row) => row.width))).toBe(2);
    }));

  it('conflictSidesAndAbort', () =>
    withTestRepo(async (t) => {
      await t.write('a.txt', 'x\n');
      await t.commitAll('init');
      await t.repo.createBranch('other', null, true);
      await t.write('a.txt', 'theirs\n');
      await t.commitAll('other');
      await t.repo.switchTo('main');
      await t.write('a.txt', 'ours\n');
      await t.commitAll('main');

      // Rebase có xung đột rồi huỷ.
      await expect(t.repo.rebase('other')).rejects.toBeInstanceOf(GitError);
      const operation = await t.repo.operationState();
      expect(operation?.kind).toBe('rebasing');
      if (!operation) throw new Error('phải đang rebase');
      await t.repo.abort(operation);
      expect(await t.repo.operationState()).toBeNull();
      expect(await t.read('a.txt')).toBe('ours\n');

      // Merge rồi chọn toàn bộ bên kia.
      await expect(t.repo.merge('other')).rejects.toBeInstanceOf(GitError);
      await t.repo.resolveConflict('a.txt', 'bothModified', false);
      expect(await t.read('a.txt')).toBe('theirs\n');
      expect((await t.repo.status()).conflicts).toEqual([]);
      await t.repo.abort({ kind: 'merging' });
      expect(await t.read('a.txt')).toBe('ours\n');
    }));

  it('stashRoundTripIncludesUntracked', () =>
    withTestRepo(async (t) => {
      await t.write('a.txt', '1\n');
      await t.commitAll('init');
      await t.write('a.txt', '2\n');
      await t.write('new.txt', 'mới\n');
      await t.repo.stashPush('cất tạm', true);
      expect(isStatusClean(await t.repo.status())).toBe(true);

      const stashes = await t.repo.stashes();
      expect(stashes).toHaveLength(1);
      const stash = stashes[0];
      if (!stash) throw new Error('phải có stash');
      expect(stashDisplayMessage(stash)).toBe('cất tạm');
      expect(stash.parents).toHaveLength(3);
      const files = await t.repo.stashFiles(stash);
      expect(files).toContainEqual({ path: 'a.txt', kind: 'modified' });
      expect(files).toContainEqual({ path: 'new.txt', kind: 'untracked' });
      const untrackedDiff = text(await t.repo.stashDiffBytes(stash, { path: 'new.txt', kind: 'untracked' }));
      expect(untrackedDiff).toContain('+mới');
      const trackedDiff = text(await t.repo.stashDiffBytes(stash, { path: 'a.txt', kind: 'modified' }));
      expect(trackedDiff).toContain('-1\n+2\n');

      // Xoá rồi khôi phục stash.
      await t.repo.stashDrop(stash.selector);
      expect(await t.repo.stashes()).toEqual([]);
      await t.repo.stashStore(stash.sha, stash.message);
      const restored = await t.repo.stashes();
      expect(restored).toHaveLength(1);

      await t.repo.stashPop(restored[0]?.selector ?? 'stash@{0}');
      expect(await t.read('a.txt')).toBe('2\n');
      expect(await t.read('new.txt')).toBe('mới\n');
    }));

  it('branchesTagsAndRefs', () =>
    withTestRepo(async (t) => {
      await t.write('a.txt', '1\n');
      await t.commitAll('init');
      const head = await t.repo.resolveCommit('HEAD');
      await t.repo.createBranch('dev', head, false);
      await t.repo.createTag('v1.0', head, 'Phiên bản 1');
      await t.repo.createTag('nhe', head, null);
      let refs = await t.repo.refs();
      expect(new Set(refs.map(refName))).toEqual(new Set(['main', 'dev', 'v1.0', 'nhe']));
      const annotated = refs.find((ref) => refName(ref) === 'v1.0');
      if (!annotated) throw new Error('thiếu tag v1.0');
      expect(isAnnotatedTag(annotated)).toBe(true);
      expect(annotated.target).toBe(head);

      await t.repo.renameBranch('dev', 'phat-trien');
      await t.repo.deleteTag('v1.0');
      await t.repo.updateRef(annotated.fullName, annotated.objectName);
      refs = await t.repo.refs();
      expect(refs.some((ref) => refName(ref) === 'phat-trien')).toBe(true);
      const restoredTag = refs.find((ref) => refName(ref) === 'v1.0');
      expect(restoredTag && isAnnotatedTag(restoredTag)).toBe(true);

      await t.repo.deleteBranch('phat-trien', false);
      expect((await t.repo.refs()).some((ref) => refName(ref) === 'phat-trien')).toBe(false);
      expect(await t.repo.isValidRefName('feature/ok', true)).toBe(true);
      expect(await t.repo.isValidRefName('bad..name', true)).toBe(false);
    }));

  it('fetchPushPullWithLocalRemote (remote bare cục bộ)', () =>
    withTempDir(async (parent) => {
      const config = isolatedConfig();
      const bare = await createBareRemote(parent, config);
      const log = new CommandLog();
      const clone = await cloneTestRepo(parent, bare, 'ban-sao', config, log);
      const other = await cloneTestRepo(parent, bare, 'nguoi-khac', config);

      const remotes = await clone.repo.remotes();
      expect(remotes.map((remote) => remote.name)).toEqual(['origin']);
      expect(remotes[0]?.fetchUrl).toBe(bare);

      // Commit ở clone rồi push.
      await clone.write('a.txt', '2\n');
      await clone.commitAll('từ clone');
      let status = await clone.repo.status();
      expect([status.ahead, status.upstream]).toEqual([1, 'origin/main']);
      const progress: string[] = [];
      await clone.repo.push({
        remote: 'origin',
        localBranch: 'main',
        remoteBranch: 'main',
        onProgress: (line) => progress.push(line),
      });
      expect(rawGit(bare, ['show', 'main:a.txt'], config)).toBe('2\n');
      expect(progress.length).toBeGreaterThan(0);

      // Người khác pull + commit + push; clone fetch rồi pull.
      other.git('pull', '--no-rebase', 'origin', 'main');
      await other.write('b.txt', 'b\n');
      await other.commitAll('từ người khác');
      other.git('push', 'origin', 'main');
      await clone.repo.fetch({ prune: true });
      status = await clone.repo.status();
      expect(status.behind).toBe(1);
      await clone.repo.pull('merge');
      status = await clone.repo.status();
      expect([status.behind, status.ahead]).toEqual([0, 0]);
      expect(await clone.exists('b.txt')).toBe(true);

      // Nhánh mới đẩy lên kèm upstream, rồi xoá trên remote.
      await clone.repo.createBranch('tinh-nang', null, true);
      await clone.repo.push({
        remote: 'origin',
        localBranch: 'tinh-nang',
        remoteBranch: 'tinh-nang',
        setUpstream: true,
      });
      const refs = await clone.repo.refs();
      expect(refs.find((ref) => refName(ref) === 'tinh-nang')?.upstream).toBe('origin/tinh-nang');
      expect(refs.some((ref) => ref.kind === 'remoteBranch' && refName(ref) === 'origin/tinh-nang')).toBe(
        true,
      );
      await clone.repo.deleteRemoteBranch('origin', 'tinh-nang');
      expect((await clone.repo.refs()).some((ref) => refName(ref) === 'origin/tinh-nang')).toBe(false);

      // Mọi lệnh đã được ghi vào nhật ký, không lệnh nào bị chính sách chặn nhầm.
      expect(log.records.every((record) => record.exitCode !== -1)).toBe(true);
      expect(log.records.some((record) => record.args[0] === 'push')).toBe(true);
    }));

  it('openRejectsNonRepository', () =>
    withTempDir(async (dir) => {
      const error = await openRepository(dir, isolatedConfig()).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RepositoryError);
      expect((error as RepositoryError).kind).toBe('notARepository');
    }));

  it.skipIf(IS_WINDOWS)('repoConfiguredFsmonitorCommandNeverRuns', () =>
    withTestRepo(async (t) => {
      // Repo lạ đặt core.fsmonitor thành script: mở/làm mới repo (git status) không được chạy nó.
      const marker = join(t.root, 'fsmonitor-ran');
      const script = await writeExecutableScript(join(t.root, 'hook.sh'), `touch "${marker}"`);
      await chmod(script, 0o755);
      t.git('config', 'core.fsmonitor', script);
      await t.write('a.txt', 'xin chào\n');

      // Đối chứng: git thật chạy thẳng KHÔNG có cờ của app thì script có chạy (nên test này có thể fail).
      t.git('status', '--short');
      expect(await t.exists('fsmonitor-ran')).toBe(true);
      await t.repo.fs.trashUntracked(['fsmonitor-ran']);

      await t.repo.status();
      await t.repo.workingDiffBytes({ path: 'a.txt', kind: 'untracked' }, 'untracked');
      await t.repo.stageAll();
      await t.repo.workingDiffBytes({ path: 'a.txt', kind: 'added' }, 'staged');
      expect(await t.exists('fsmonitor-ran')).toBe(false);
      expect((await readdir(t.root)).includes('fsmonitor-ran')).toBe(false);
    }),
  );
});

describe('Repository: đường dẫn lạ và đầu vào xấu', () => {
  it('tên file Unicode, có dấu cách, bắt đầu bằng "-", ký tự glob đều đi qua stdin/pathspec literal an toàn', () =>
    withTestRepo(async (t) => {
      const names = [
        'Tài liệu/ghi chú.txt',
        'có dấu cách.txt',
        '-bắt-đầu-bằng-gạch.txt',
        '--upload-pack=x.txt',
        'a.txt',
      ];
      if (!IS_WINDOWS) names.push('*.txt', '[ab].txt', ':(top)x.txt');
      for (const name of names) await t.write(name, `${name}\n`);

      await t.repo.stage(['-bắt-đầu-bằng-gạch.txt', '--upload-pack=x.txt', 'Tài liệu/ghi chú.txt']);
      let status = await t.repo.status();
      expect(status.staged.map((change) => change.path).sort()).toEqual([
        '--upload-pack=x.txt',
        '-bắt-đầu-bằng-gạch.txt',
        'Tài liệu/ghi chú.txt',
      ]);

      if (!IS_WINDOWS) {
        // Pathspec literal: "*.txt" chỉ là chính file tên "*.txt", không phải mọi file .txt.
        await t.repo.stage(['*.txt']);
        status = await t.repo.status();
        expect(status.staged.map((change) => change.path)).toContain('*.txt');
        expect(status.staged.map((change) => change.path)).not.toContain('a.txt');
        await t.repo.stage([':(top)x.txt']);
        expect((await t.repo.status()).staged.map((change) => change.path)).toContain(':(top)x.txt');
      }
      await t.repo.commit('một số file');
      await t.repo.discard(['-bắt-đầu-bằng-gạch.txt']);
      await t.write('-bắt-đầu-bằng-gạch.txt', 'sửa\n');
      expect((await t.repo.status()).unstaged.map((change) => change.path).sort()).toEqual(
        ['-bắt-đầu-bằng-gạch.txt', 'a.txt', 'có dấu cách.txt', ...(IS_WINDOWS ? [] : ['[ab].txt'])].sort(),
      );
      await t.repo.discard(['-bắt-đầu-bằng-gạch.txt']);
      expect(await t.read('-bắt-đầu-bằng-gạch.txt')).toBe('-bắt-đầu-bằng-gạch.txt\n');
      // Đường dẫn chứa NUL bị từ chối ở biên (nếu lọt vào danh sách NUL sẽ thành thêm một pathspec).
      await expect(t.repo.stage(['a.txt\0b.txt'])).rejects.toBeInstanceOf(RangeError);
      await expect(t.repo.stage([''])).rejects.toBeInstanceOf(RangeError);
    }));

  it('đường dẫn dài hơn 200 ký tự (Windows cần core.longpaths) và thư mục lồng sâu', () =>
    withTestRepo(async (t) => {
      t.git('config', 'core.longpaths', 'true');
      const directory = ['d'.repeat(60), 'é'.repeat(60), 'f'.repeat(60), 'g'.repeat(30)].join('/');
      const path = `${directory}/tệp dài.txt`;
      expect(path.length).toBeGreaterThan(200);
      await t.write(path, 'nội dung\n');
      expect((await t.repo.status()).unstaged).toEqual([{ path, kind: 'untracked' }]);
      await t.repo.stage([path]);
      await t.repo.commit('đường dẫn dài');
      expect(isStatusClean(await t.repo.status())).toBe(true);
      await t.write(path, 'nội dung mới\n');
      expect(text(await t.repo.workingDiffBytes({ path, kind: 'modified' }, 'unstaged'))).toContain(
        '+nội dung mới',
      );
      expect(text((await t.repo.workingFileBytes(path)) ?? new Uint8Array(0))).toBe('nội dung mới\n');
      await t.repo.discard([path]);
      expect(await t.read(path)).toBe('nội dung\n');
      expect((await t.repo.fileHistory(path)).map((entry) => entry.commit.subject)).toEqual([
        'đường dẫn dài',
      ]);
    }));

  it('addToGitignore thêm theo byte và git thực sự bỏ qua file đó', () =>
    withTestRepo(async (t) => {
      await t.write('app.log', 'nhật ký\n');
      await t.write('giữ lại.txt', 'x\n');
      expect((await t.repo.status()).unstaged.map((change) => change.path).sort()).toEqual([
        'app.log',
        'giữ lại.txt',
      ]);
      await t.repo.addToGitignore('*.log');
      expect(await t.read('.gitignore')).toBe('*.log\n');
      expect((await t.repo.status()).unstaged.map((change) => change.path).sort()).toEqual([
        '.gitignore',
        'giữ lại.txt',
      ]);
      await t.repo.addToGitignore('Tài liệu/');
      expect(await t.read('.gitignore')).toBe('*.log\nTài liệu/\n');
    }));

  it('tên nhánh/rev/remote bắt đầu bằng "-" hoặc chứa ký tự refspec bị từ chối trước khi chạy git', () =>
    withTestRepo(async (t) => {
      await t.write('a.txt', '1\n');
      await t.commitAll('init');
      const before = await t.repo.refs();
      const rejected: (() => Promise<unknown>)[] = [
        () => t.repo.switchTo('--force'),
        () => t.repo.switchTo(''),
        () => t.repo.createBranch('-x', null, false),
        () => t.repo.createBranch('ok', '--orphan', false),
        () => t.repo.deleteBranch('-D', true),
        () => t.repo.merge('--abort'),
        () => t.repo.rebase('--root'),
        () => t.repo.cherryPick('--continue'),
        () => t.repo.reset('--hard', 'hard'),
        () => t.repo.commitMessage('-n'),
        () => t.repo.stashApply('--index'),
        () => t.repo.createTag('-d', 'HEAD', null),
        () => t.repo.fetch({ remote: '--all' }),
        () => t.repo.push({ remote: 'origin', localBranch: 'a:b', remoteBranch: 'x' }),
        () => t.repo.push({ remote: '-x', localBranch: 'a', remoteBranch: 'x' }),
        () => t.repo.pushTag('origin', 'v1:v2'),
        () => t.repo.pushCommit('HEAD', 'origin', 'x'),
        () => t.repo.deleteRemoteBranch('origin', '..'),
        () => t.repo.config('--unset-all'),
        () => t.repo.addRemote('--mirror', 'https://x/y'),
      ];
      for (const [index, call] of rejected.entries()) {
        const error = await call().catch((e: unknown) => e);
        expect(error, `ca ${index}`).toBeInstanceOf(RepositoryError);
        expect((error as RepositoryError).kind).toBe('invalidName');
      }
      expect(await t.repo.refs()).toEqual(before);
    }));

  it('thiếu bộ chuyển lệnh có kiểu → lỗi rõ ràng; có thì setConfig/addRemote/setRemoteUrl chạy được và kiểm đầu vào', () =>
    withTestRepo(async (t) => {
      const { GitRepository } = await import('../src/git/index.ts');
      const bare = new GitRepository({
        exec: t.repo.runner.exec,
        fs: t.repo.fs,
        root: t.root,
        gitDir: t.repo.gitDir,
        commonDir: t.repo.commonDir,
      });
      for (const call of [
        () => bare.setConfig('user.name', 'x', 'local'),
        () => bare.addRemote('o', 'https://x/y'),
        () => bare.setRemoteUrl('o', 'https://x/y'),
      ]) {
        const error = await call().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(AdapterError);
        expect((error as AdapterError).code).toBe('internal');
      }
      await t.repo.setConfig('user.name', 'Tên mới', 'local');
      expect(await t.repo.config('user.name')).toBe('Tên mới');
      await t.repo.addRemote('origin', 'https://example.com/a.git');
      await t.repo.setRemoteUrl('origin', 'https://example.com/b.git');
      expect((await t.repo.remotes())[0]).toEqual({
        name: 'origin',
        fetchUrl: 'https://example.com/b.git',
        pushUrl: 'https://example.com/b.git',
      });
      await t.repo.renameRemote('origin', 'nguồn');
      expect((await t.repo.remotes()).map((remote) => remote.name)).toEqual(['nguồn']);
      await expect(t.repo.renameRemote('nguồn', '--mirror')).rejects.toBeInstanceOf(RepositoryError);
      await expect(t.repo.renameRemote('nguồn', 'a..b')).rejects.toBeInstanceOf(RepositoryError);
      await t.repo.removeRemote('nguồn');
      expect(await t.repo.remotes()).toEqual([]);
      await expect(t.repo.setConfig('core.fsmonitor', 'touch /tmp/pwned', 'local')).rejects.toMatchObject({
        code: 'policy',
      });
      await expect(t.repo.addRemote('x', 'ext::sh -c id')).rejects.toMatchObject({ code: 'policy' });
      expect(await t.repo.config('khong.co')).toBeNull();
      expect(await t.repo.config('user.email')).toBe('test@example.com');
    }));

  it('nhật ký lệnh không giữ credential dù URL có mật khẩu nằm trong đối số', () =>
    withTempDir(async (parent) => {
      const config = isolatedConfig();
      const log = new CommandLog();
      const dir = join(parent, 'r');
      await (await import('node:fs/promises')).mkdir(dir);
      const { NodeGitHost } = await import('../src/node/index.ts');
      await new NodeGitHost(config).init(dir);
      const repo = await openRepository(dir, { ...config, log });
      const error = await repo
        .fetch({ remote: 'https://nguoidung:matkhau-bi-mat@127.0.0.1:1/x.git' })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GitError);
      const stored = JSON.stringify(log.records);
      expect(stored).not.toContain('matkhau-bi-mat');
      expect(log.records.at(-1)?.args).toEqual(['fetch', '--progress', 'https://***@127.0.0.1:1/x.git']);
      expect(log.records.at(-1)?.exitCode).toBe(128);
    }));

  it('hashObject lưu byte nguyên vẹn (UTF-8 sai, NUL, CRLF) và blob đọc lại đúng từng byte', () =>
    withTestRepo(async (t) => {
      const content = Uint8Array.from([0x61, 0x0d, 0x0a, 0xff, 0xfe, 0x00, 0xe9, 0x62]);
      const sha = await t.repo.hashObject(content);
      expect(sha).toMatch(/^[0-9a-f]{40,64}$/);
      expect(Array.from(await t.repo.blob(sha))).toEqual(Array.from(content));
      expect(rawGit(t.root, ['cat-file', '-t', sha], t.config).trim()).toBe('blob');
      // Nội dung không đổi → cùng sha (không phụ thuộc working tree).
      expect(await t.repo.hashObject(content)).toBe(sha);
    }));

  it('workingFileBytes / readWorkingFile chỉ đọc trong repo; số dòng ngữ cảnh không hợp lệ bị từ chối', () =>
    withTestRepo(async (t) => {
      await t.write('a.txt', numberedLines(5).join('\n'));
      expect(text((await t.repo.workingFileBytes('a.txt')) ?? new Uint8Array(0))).toBe(
        'line 1\nline 2\nline 3\nline 4\nline 5',
      );
      expect(await t.repo.workingFileBytes('khong-co.txt')).toBeNull();
      await expect(t.repo.workingFileBytes('../ngoai.txt')).rejects.toMatchObject({ code: 'out-of-scope' });
      await expect(
        t.repo.workingDiffBytes({ path: 'a.txt', kind: 'modified' }, 'unstaged', -1),
      ).rejects.toBeInstanceOf(RangeError);
      await expect(
        t.repo.workingDiffBytes({ path: 'a.txt', kind: 'modified' }, 'unstaged', 1.5),
      ).rejects.toBeInstanceOf(RangeError);
    }));
});
