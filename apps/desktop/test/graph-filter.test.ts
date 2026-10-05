// Hiding / "show only" (solo) branches on the graph — on a real git repo.
import { afterEach, describe, expect, it } from 'vitest';
import {
  graphFilterSummary,
  showAllBranches,
  toggleHidden,
  toggleSolo,
} from '../src/lib/actions/graphFilter.ts';
import { PrefsStore } from '../src/lib/stores/prefs.svelte.ts';
import { RepoStore } from '../src/lib/stores/repo.svelte.ts';
import { ToastStore } from '../src/lib/stores/toasts.svelte.ts';
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

async function openStore(): Promise<RepoStore> {
  const test = await openTestPort((git) => {
    git('commit', '-q', '--allow-empty', '-m', 'gốc');
    git('switch', '-q', '-c', 'an');
    git('commit', '-q', '--allow-empty', '-m', 'riêng nhánh ẩn');
    git('switch', '-q', 'main');
    git('switch', '-q', '-c', 'khac');
    git('commit', '-q', '--allow-empty', '-m', 'riêng nhánh khác');
    git('switch', '-q', 'main');
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
  await until(() => store.hasLoaded && store.entries.length > 0, 'nạp xong');
  return store;
}

const subjects = (store: RepoStore): string[] => store.entries.map((entry) => entry.commit.subject).sort();

describe('ẩn / solo nhánh trên graph', () => {
  it('ẩn bỏ lịch sử riêng của nhánh, solo chỉ còn nhánh đó, hiện tất cả trả về như cũ', async () => {
    const store = await openStore();
    expect(subjects(store)).toEqual(['gốc', 'riêng nhánh khác', 'riêng nhánh ẩn']);
    const an = store.localBranches.find((ref) => ref.fullName === 'refs/heads/an')!;
    const khac = store.localBranches.find((ref) => ref.fullName === 'refs/heads/khac')!;
    const main = store.localBranches.find((ref) => ref.fullName === 'refs/heads/main')!;

    toggleHidden(store, an);
    await until(() => subjects(store).length === 2, 'ẩn nhánh');
    expect(subjects(store)).toEqual(['gốc', 'riêng nhánh khác']);
    expect(graphFilterSummary(store)).toBe('Đang ẩn 1 nhánh');

    toggleHidden(store, main);
    expect(store.graphFilter.hidden).toEqual(['refs/heads/an']);

    toggleSolo(store, khac);
    await until(
      () => !subjects(store).includes('riêng nhánh ẩn') && store.graphFilter.solo.length === 1,
      'solo',
    );
    expect(subjects(store)).toEqual(['gốc', 'riêng nhánh khác']);
    expect(graphFilterSummary(store)).toBe('Chỉ hiện 1 nhánh (và nhánh đang checkout)');

    showAllBranches(store);
    await until(() => subjects(store).length === 3, 'hiện tất cả');
    expect(graphFilterSummary(store)).toBeNull();
  });
});
