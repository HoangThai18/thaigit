import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { snapshotSpec } from '@thaigit/contracts';
import { describe, expect, it } from 'vitest';
import { SnapshotStore } from '../src/git/snapshot.ts';
import { openRepository } from '../src/node/index.ts';
import { IS_WINDOWS, fileExists, withTestRepo, type TestRepo } from './helpers/test-repo.ts';

const REF = snapshotSpec.ref;

/** Trạng thái người dùng nhìn thấy: index, nhánh, stash, HEAD — snapshot không được đụng tới. */
function userState(t: TestRepo) {
  return {
    status: t.git('status', '--porcelain=v1', '-z', '--untracked-files=all'),
    cached: t.git('diff', '--cached', '--name-status'),
    head: t.git('rev-parse', '--verify', '-q', 'HEAD').trim(),
    branches: t.git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/tags'),
    stash: t.git('stash', 'list'),
  };
}

async function seeded(t: TestRepo) {
  await t.write('a.txt', 'a1\n');
  await t.write('.gitignore', 'build/\n*.log\n');
  await t.commitAll('init');
}

describe('SnapshotStore.take', () => {
  it('chụp cả file sửa lẫn file chưa track, bỏ file ignore, không đụng index / nhánh / stash / HEAD', () =>
    withTestRepo(async (t) => {
      await seeded(t);
      await t.write('a.txt', 'a2\n');
      await t.write('thư mục/tệp có dấu cách.txt', 'mới\n');
      await t.write('build/out.bin', 'bỏ qua');
      await t.write('debug.log', 'bỏ qua');
      await t.write('staged.txt', 'đã stage\n');
      t.git('add', 'staged.txt');
      const before = userState(t);

      const store = new SnapshotStore(t.repo);
      const entry = await store.take('auto');

      expect(userState(t)).toEqual(before);
      expect(t.git('show', `${entry.sha}:a.txt`)).toBe('a2\n');
      expect(t.git('show', `${entry.sha}:thư mục/tệp có dấu cách.txt`)).toBe('mới\n');
      expect(t.git('show', `${entry.sha}:staged.txt`)).toBe('đã stage\n');
      expect(t.git('ls-tree', '-r', '--name-only', entry.sha)).not.toMatch(/build\/|debug\.log/);
      expect(t.git('rev-parse', `${entry.sha}^`).trim()).toBe(before.head);
      expect(t.git('log', '-1', '--format=%an <%ae>', entry.sha).trim()).toBe(
        'Thaigit <snapshot@thaigit.invalid>',
      );
      expect(entry).toMatchObject({ index: 0, reason: 'auto', files: 3 });
      expect(t.git('rev-parse', REF).trim()).toBe(entry.sha);
    }));

  it('không có gì đổi thì không tạo mốc mới', () =>
    withTestRepo(async (t) => {
      await seeded(t);
      await t.write('a.txt', 'a2\n');
      const store = new SnapshotStore(t.repo);
      const first = await store.take('auto');
      const second = await store.take('auto');
      expect(second.sha).toBe(first.sha);
      expect(await store.list()).toHaveLength(1);
      await t.write('a.txt', 'a3\n');
      const third = await store.take('manual');
      expect(third.sha).not.toBe(first.sha);
      expect((await store.list()).map((entry) => entry.reason)).toEqual(['manual', 'auto']);
    }));

  it('repo chưa có commit: mốc không có cha', () =>
    withTestRepo(async (t) => {
      await t.write('dau-tien.txt', 'x\n');
      const entry = await new SnapshotStore(t.repo).take('auto');
      expect(t.git('rev-list', '--parents', '-n1', entry.sha).trim()).toBe(entry.sha);
      expect(entry.files).toBe(1);
    }));

  it('repo bật ký commit (gpg.program hỏng) vẫn chụp được — snapshot không bao giờ gọi chương trình ký', () =>
    withTestRepo(async (t) => {
      await seeded(t);
      t.git('config', 'commit.gpgSign', 'true');
      t.git('config', 'gpg.program', IS_WINDOWS ? 'C:\\khong-co\\gpg.exe' : '/bin/false');
      await t.write('a.txt', 'a2\n');
      const entry = await new SnapshotStore(t.repo).take('auto');
      expect(t.git('show', `${entry.sha}:a.txt`)).toBe('a2\n');
    }));

  it('file khoá mồ côi của index tạm (app bị tắt giữa chừng) được dọn rồi chụp lại', () =>
    withTestRepo(async (t) => {
      await seeded(t);
      const dir = join(await realpath(t.repo.gitDir), 'thaigit');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'snapshot.index.lock'), '');
      await t.write('a.txt', 'a2\n');
      const entry = await new SnapshotStore(t.repo).take('auto');
      expect(t.git('show', `${entry.sha}:a.txt`)).toBe('a2\n');
      expect(await fileExists(join(dir, 'snapshot.index.lock'))).toBe(false);
    }));

  it('mỗi worktree có dòng thời gian riêng', () =>
    withTestRepo(async (t) => {
      await seeded(t);
      await t.write('a.txt', 'a2\n');
      await new SnapshotStore(t.repo).take('auto');
      const other = join(t.root, '..', 'wt-khac');
      t.git('worktree', 'add', '-q', '-b', 'khac', other);
      const otherRepo = await openRepository(other, t.config);
      const otherStore = new SnapshotStore(otherRepo);
      expect(await otherStore.list()).toEqual([]);
      await writeFile(join(other, 'b.txt'), 'b\n');
      await otherStore.take('auto');
      expect(await otherStore.list()).toHaveLength(1);
      expect(await new SnapshotStore(t.repo).list()).toHaveLength(1);
    }));
});

describe('SnapshotStore.list / changes', () => {
  it('bỏ qua mục reflog không phải snapshot của Thaigit nhưng giữ đúng chỉ số reflog', () =>
    withTestRepo(async (t) => {
      await seeded(t);
      const store = new SnapshotStore(t.repo);
      await t.write('a.txt', 'a2\n');
      await store.take('auto');
      t.git('update-ref', '--create-reflog', '-m', 'la', REF, 'HEAD');
      await t.write('a.txt', 'a3\n');
      await store.take('auto');
      const entries = await store.list();
      expect(entries.map((entry) => entry.index)).toEqual([0, 2]);
    }));

  it('liệt kê file khác nhau giữa hai mốc', () =>
    withTestRepo(async (t) => {
      await seeded(t);
      const store = new SnapshotStore(t.repo);
      await t.write('a.txt', 'a2\n');
      const first = await store.take('auto');
      await t.write('a.txt', 'a3\n');
      await t.write('moi.txt', 'm\n');
      const second = await store.take('auto');
      const changes = await store.changes(first.sha, second.sha);
      expect(changes.map((change) => `${change.kind} ${change.path}`).sort()).toEqual([
        'added moi.txt',
        'modified a.txt',
      ]);
    }));
});

describe('SnapshotStore.restore', () => {
  it('khôi phục một file đúng từng byte, không đụng index; hoàn tác trả lại bản trước', () =>
    withTestRepo(async (t) => {
      await seeded(t);
      const original = new Uint8Array([0xef, 0xbb, 0xbf, 0x78, 0x0d, 0x0a, 0xe9, 0x00, 0xff, 0x0a]);
      await t.write('du-lieu.bin', original);
      await t.write('khac.txt', 'giữ nguyên\n');
      const store = new SnapshotStore(t.repo);
      const target = await store.take('auto');

      await t.write('du-lieu.bin', 'agent ghi đè\r\n');
      await t.write('khac.txt', 'cũng đổi\n');
      const cachedBefore = t.git('diff', '--cached', '--name-status');

      const result = await store.restore(target.sha, ['du-lieu.bin']);
      expect(await t.readBytes('du-lieu.bin')).toEqual(original);
      expect(await t.read('khac.txt')).toBe('cũng đổi\n');
      expect(t.git('diff', '--cached', '--name-status')).toBe(cachedBefore);
      expect(result.before.reason).toBe('before-restore');

      await store.restore(result.before.sha, ['du-lieu.bin']);
      expect(await t.read('du-lieu.bin')).toBe('agent ghi đè\r\n');
    }));

  it('khôi phục tất cả: trả file bị xoá, bỏ file mới vào thùng rác, hoàn tác đưa mọi thứ về như trước', () =>
    withTestRepo(async (t) => {
      await seeded(t);
      await t.write('b.txt', 'b\n');
      await t.commitAll('thêm b');
      await t.write('nhap.txt', 'bản nháp cũ\n');
      const store = new SnapshotStore(t.repo);
      const target = await store.take('auto');

      // Agent: sửa a, xoá b (đã track) và nhap.txt (chưa track), tạo thư mục mới, stage một file.
      await t.write('a.txt', 'agent\n');
      t.git('rm', '-q', '--cached', 'b.txt');
      t.git('clean', '-fq', 'b.txt');
      t.git('clean', '-fq', 'nhap.txt');
      await t.write('src/moi/x.ts', 'export {}\n');
      await t.write('staged.txt', 's\n');
      t.git('add', 'staged.txt');
      const cachedBefore = t.git('diff', '--cached', '--name-status');

      const result = await store.restore(target.sha, null);
      expect(await t.read('a.txt')).toBe('a1\n');
      expect(await t.read('b.txt')).toBe('b\n');
      expect(await t.read('nhap.txt')).toBe('bản nháp cũ\n');
      expect(await t.exists('src/moi/x.ts')).toBe(false);
      expect(t.git('diff', '--cached', '--name-status')).toBe(cachedBefore);
      expect(result.trashed).toContain('src/moi/x.ts');
      // staged.txt có trong index (đã track) nhưng không có trong mốc: bị xoá khỏi working tree, index giữ nguyên.
      expect(await t.exists('staged.txt')).toBe(false);

      await store.restore(result.before.sha, null);
      expect(await t.read('a.txt')).toBe('agent\n');
      expect(await t.exists('b.txt')).toBe(false);
      expect(await t.exists('nhap.txt')).toBe(false);
      expect(await t.read('src/moi/x.ts')).toBe('export {}\n');
      expect(await t.read('staged.txt')).toBe('s\n');
    }));

  it('đang ở mốc đó rồi thì không làm gì', () =>
    withTestRepo(async (t) => {
      await seeded(t);
      await t.write('a.txt', 'a2\n');
      const store = new SnapshotStore(t.repo);
      const target = await store.take('auto');
      const result = await store.restore(target.sha, null);
      expect(result.restored).toEqual([]);
      expect(result.trashed).toEqual([]);
      expect(await t.read('a.txt')).toBe('a2\n');
    }));
});

describe('SnapshotStore.prune', () => {
  it('xoá mốc quá số lượng và quá hạn, luôn giữ mốc mới nhất', () =>
    withTestRepo(async (t) => {
      await seeded(t);
      const store = new SnapshotStore(t.repo);
      for (const value of ['1', '2', '3', '4']) {
        await t.write('a.txt', `${value}\n`);
        await store.take('auto');
      }
      const now = Math.floor(Date.now() / 1000);
      expect(await store.prune({ now, keepDays: 7, keepCount: 300 })).toBe(0);
      expect(await store.prune({ now, keepDays: 7, keepCount: 2 })).toBe(2);
      const left = await store.list();
      expect(left.map((entry) => entry.index)).toEqual([0, 1]);
      expect(t.git('show', `${left[0]?.sha}:a.txt`)).toBe('4\n');
      expect(await store.prune({ now: now + 8 * 86_400, keepDays: 7, keepCount: 300 })).toBe(1);
      expect(await store.list()).toHaveLength(1);
      expect(t.git('rev-parse', REF).trim()).toBe(left[0]?.sha);
    }));

  it('chưa có mốc nào: không lỗi', () =>
    withTestRepo(async (t) => {
      await seeded(t);
      const store = new SnapshotStore(t.repo);
      expect(await store.list()).toEqual([]);
      expect(await store.prune({ now: 0, keepDays: 7, keepCount: 300 })).toBe(0);
    }));
});
