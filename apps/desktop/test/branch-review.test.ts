import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { refMenu } from '../src/lib/actions/menus.ts';
import { PrefsStore } from '../src/lib/stores/prefs.svelte.ts';
import { RepoStore } from '../src/lib/stores/repo.svelte.ts';
import { ToastStore } from '../src/lib/stores/toasts.svelte.ts';
import { vi } from '../src/lib/strings.vi.ts';
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

/** main (base.txt, then moves on with main.txt) and feat (branched from base: edits base.txt, adds feat.txt); main is checked out. */
async function openStore() {
  const shas = { base: '', feat: '' };
  const test = await openTestPort((git, root) => {
    writeFileSync(join(root, 'base.txt'), 'một\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    shas.base = git('rev-parse', 'HEAD').trim();
    git('checkout', '-q', '-b', 'feat');
    writeFileSync(join(root, 'base.txt'), 'một\nhai\n');
    writeFileSync(join(root, 'feat.txt'), 'f\n');
    git('add', '.');
    git('commit', '-q', '-m', 'feat');
    shas.feat = git('rev-parse', 'HEAD').trim();
    git('checkout', '-q', 'main');
    writeFileSync(join(root, 'main.txt'), 'm\n');
    git('add', '.');
    git('commit', '-q', '-m', 'main đi tiếp');
  });
  cleanups.push(() => test.cleanup());
  const store = new RepoStore(test.port, {
    prefs: new PrefsStore(null),
    toasts: new ToastStore(),
    detailsDelayMs: 0,
    clipboard: async () => {},
  });
  cleanups.push(() => store.dispose());
  await store.start();
  await until(() => store.hasLoaded, 'nạp xong');
  return { store, shas };
}

function ref(store: RepoStore, fullName: string) {
  const found = store.findRef(fullName);
  if (found === undefined) throw new Error(`thiếu ref ${fullName}`);
  return found;
}

describe('review thay đổi của nhánh so với nhánh khác', () => {
  it('liệt kê file của nhánh kể từ điểm tách, không lẫn thay đổi mới của nhánh kia', async () => {
    const { store, shas } = await openStore();
    store.branchReview.open(ref(store, 'refs/heads/feat'), ref(store, 'refs/heads/main'));
    expect(store.branchReview.isOpen).toBe(true);
    await until(() => store.branchReview.phase === 'ready', 'so sánh xong');
    expect(store.branchReview.changes?.head).toBe(shas.feat);
    expect(store.branchReview.changes?.from).toBe(shas.base);
    expect(store.branchReview.changes?.files.map((file) => `${file.kind}:${file.path}`)).toEqual([
      'modified:base.txt',
      'added:feat.txt',
    ]);
    expect(store.branchReview.label).toBe('main...feat');
  });

  it('bấm file mở diff so với điểm tách, tô hàng; đóng panel thì đóng diff', async () => {
    const { store, shas } = await openStore();
    store.branchReview.open(ref(store, 'refs/heads/feat'), ref(store, 'refs/heads/main'));
    await until(() => store.branchReview.phase === 'ready', 'so sánh xong');
    const file = store.branchReview.changes?.files.find((change) => change.path === 'feat.txt');
    expect(file).toBeDefined();
    store.branchReview.openFile(file!);
    expect(store.diff.file?.source).toEqual({
      kind: 'commit',
      sha: shas.feat,
      parent: shas.base,
      label: 'main...feat',
    });
    expect(store.branchReview.openPath).toBe('feat.txt');
    store.branchReview.close();
    expect(store.branchReview.isOpen).toBe(false);
    expect(store.diff.file).toBeNull();
  });

  it('chọn commit khác đóng panel; mở review PR / lịch sử file cũng đóng panel nhánh', async () => {
    const { store } = await openStore();
    store.branchReview.open(ref(store, 'refs/heads/feat'), ref(store, 'refs/heads/main'));
    store.select({ kind: 'workingTree' });
    expect(store.branchReview.isOpen).toBe(false);
    store.branchReview.open(ref(store, 'refs/heads/feat'), ref(store, 'refs/heads/main'));
    store.fileHistory.open('base.txt');
    expect(store.branchReview.isOpen).toBe(false);
  });

  it('menu chuột phải của nhánh có mục review so với nhánh đang đứng và nhánh khác', async () => {
    const { store } = await openStore();
    const items = refMenu(store, ref(store, 'refs/heads/feat'));
    const against = items.find(
      (item) => 'title' in item && item.title === vi.branches.menuReviewAgainst('main'),
    );
    expect(against).toBeDefined();
    (against as { run: () => void }).run();
    expect(store.branchReview.head?.fullName).toBe('refs/heads/feat');
    expect(store.branchReview.base?.fullName).toBe('refs/heads/main');
    // The checked-out branch has nothing to compare "against the current branch".
    const own = refMenu(store, ref(store, 'refs/heads/main'));
    expect(own.some((item) => 'title' in item && item.title === vi.branches.menuReviewAgainst('main'))).toBe(
      false,
    );
  });
});
