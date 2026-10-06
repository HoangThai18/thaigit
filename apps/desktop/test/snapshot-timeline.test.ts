import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DialogStore } from '../src/lib/stores/dialogs.svelte.ts';
import { PrefsStore, sanitizePrefs } from '../src/lib/stores/prefs.svelte.ts';
import { RepoStore } from '../src/lib/stores/repo.svelte.ts';
import { ToastStore } from '../src/lib/stores/toasts.svelte.ts';
import { vi as strings } from '../src/lib/strings.vi.ts';
import { openTestPort } from './helpers/node-port.ts';

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function until(condition: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Hết giờ chờ: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function openStore() {
  const test = await openTestPort((git, root) => {
    writeFileSync(join(root, 'a.txt'), 'a1\n');
    git('add', '.');
    git('commit', '-q', '-m', 'Khởi tạo');
  });
  cleanups.push(() => test.cleanup());
  const prefs = new PrefsStore(null);
  const toasts = new ToastStore();
  const store = new RepoStore(test.port, { prefs, toasts, detailsDelayMs: 0, clipboard: async () => {} });
  cleanups.push(() => store.dispose());
  await store.start();
  await until(() => store.hasLoaded, 'nạp xong');
  return { test, store, toasts, prefs };
}

function lastAction(toasts: ToastStore, title: string): () => void {
  const toast = [...toasts.items]
    .reverse()
    .find((item) => item.actions.some((action) => action.title === title));
  const action = toast?.actions.find((candidate) => candidate.title === title);
  if (!action) throw new Error(`Không thấy nút “${title}”`);
  return action.run;
}

describe('cài đặt Dòng thời gian', () => {
  it('mặc định bật, 7 ngày / 300 mốc; giá trị hỏng bị kẹp lại', () => {
    const base = sanitizePrefs(null);
    expect(base).toMatchObject({ snapshotsEnabled: true, snapshotKeepDays: 7, snapshotKeepCount: 300 });
    expect(base.snapshotsDisabledRepos).toEqual([]);
    const odd = sanitizePrefs({
      snapshotKeepDays: 999,
      snapshotKeepCount: 1,
      snapshotsDisabledRepos: ['/a', 3, '', '/a', '/b'],
    });
    expect(odd).toMatchObject({ snapshotKeepDays: 90, snapshotKeepCount: 20 });
    expect(odd.snapshotsDisabledRepos).toEqual(['/a', '/b']);
  });
});

describe('TimelineStore', () => {
  it('lưu mốc, so với bây giờ, khôi phục tất cả có hỏi trước, rồi hoàn tác', async () => {
    const { test, store, toasts } = await openStore();
    const timeline = store.timeline;
    await test.write('a.txt', 'bản tốt\n');
    await timeline.takeNow();
    timeline.open();
    await until(() => timeline.entries.length === 1, 'có một mốc');
    const target = timeline.entries[0]!;

    await test.write('a.txt', 'agent làm hỏng\n');
    await test.write('rac.txt', 'file agent tạo\n');
    await timeline.select(target);
    expect(timeline.comparison?.files.map((file) => file.path).sort()).toEqual(['a.txt', 'rac.txt']);

    const dialogs = new DialogStore();
    const cancelled = timeline.restore(null, { dialogs });
    await until(() => dialogs.current !== null, 'hộp xác nhận');
    dialogs.answer('cancel');
    await cancelled;
    expect(readFileSync(join(test.root, 'a.txt'), 'utf8')).toBe('agent làm hỏng\n');

    const restoring = timeline.restore(null, { dialogs });
    await until(() => dialogs.current !== null, 'hộp xác nhận');
    dialogs.answer('confirm');
    await restoring;
    expect(readFileSync(join(test.root, 'a.txt'), 'utf8')).toBe('bản tốt\n');
    expect(existsSync(join(test.root, 'rac.txt'))).toBe(false);
    expect(timeline.comparison?.files).toEqual([]);

    lastAction(toasts, strings.snapshots.undo)();
    // `git restore` deletes then recreates the file: reading it at that moment hits ENOENT — treat that as "not finished", not an error.
    const current = (): string | null => {
      try {
        return readFileSync(join(test.root, 'a.txt'), 'utf8');
      } catch {
        return null;
      }
    };
    await until(() => current() === 'agent làm hỏng\n', 'hoàn tác khôi phục');
    await until(() => existsSync(join(test.root, 'rac.txt')), 'file agent tạo quay lại');
  });

  it('khôi phục một file, mở diff của file trong mốc', async () => {
    const { test, store } = await openStore();
    const timeline = store.timeline;
    await test.write('a.txt', 'bản tốt\n');
    await test.write('b.txt', 'b\n');
    await timeline.takeNow();
    timeline.open();
    await until(() => timeline.entries.length === 1, 'có một mốc');
    await test.write('a.txt', 'hỏng\n');
    await test.write('b.txt', 'b đổi\n');
    await timeline.select(timeline.entries[0]!);
    const change = timeline.comparison!.files.find((file) => file.path === 'a.txt')!;
    timeline.openFile(change);
    await until(() => store.diff.state.kind === 'text', 'diff mốc');

    const dialogs = new DialogStore();
    const restoring = timeline.restore(['a.txt'], { dialogs });
    await until(() => dialogs.current !== null, 'hộp xác nhận');
    dialogs.answer('confirm');
    await restoring;
    expect(readFileSync(join(test.root, 'a.txt'), 'utf8')).toBe('bản tốt\n');
    expect(readFileSync(join(test.root, 'b.txt'), 'utf8')).toBe('b đổi\n');
  });

  it('lần tự lưu đầu tiên trên máy giải thích một lần, kèm nút tắt cho repo; dọn mốc theo cài đặt', async () => {
    const { test, store, toasts, prefs } = await openStore();
    const timeline = store.timeline;
    await test.write('a.txt', 'a2\n');
    await timeline.autoTake();
    await test.write('a.txt', 'a3\n');
    await timeline.autoTake();
    const notices = toasts.items.filter((item) => item.title === strings.snapshots.firstNotice);
    expect(notices).toHaveLength(1);
    expect(prefs.value.snapshotNoticeShown).toBe(true);
    lastAction(toasts, strings.snapshots.disableForRepo)();
    expect(timeline.enabled).toBe(false);

    prefs.update({ snapshotKeepCount: 20 });
    expect(await timeline.snapshots.list()).toHaveLength(2);
    await timeline.autoPrune();
    expect(await timeline.snapshots.list()).toHaveLength(2);
  });

  it('tắt / bật tự lưu riêng cho repo; chọn commit trên graph thì đóng dòng thời gian', async () => {
    const { store, prefs } = await openStore();
    const timeline = store.timeline;
    expect(timeline.enabled).toBe(true);
    timeline.setEnabledForRepo(false);
    expect(prefs.value.snapshotsDisabledRepos).toContain(store.rootPath);
    expect(timeline.enabled).toBe(false);
    timeline.setEnabledForRepo(true);
    expect(timeline.enabled).toBe(true);
    prefs.update({ snapshotsEnabled: false });
    expect(timeline.enabled).toBe(false);

    timeline.open();
    expect(timeline.isOpen).toBe(true);
    store.select({ kind: 'commit', sha: store.entries[0]!.commit.id });
    expect(timeline.isOpen).toBe(false);
  });
});
