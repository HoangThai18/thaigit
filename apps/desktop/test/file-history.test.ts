import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isUncommittedBlame } from '@thaigit/core';
import { afterEach, describe, expect, it } from 'vitest';
import { fileMenu } from '../src/lib/actions/menus.ts';
import { openBlame, openFileHistory, showCommitInGraph } from '../src/lib/history/actions.ts';
import type { MenuItem } from '../src/lib/stores/menus.svelte.ts';
import { PrefsStore } from '../src/lib/stores/prefs.svelte.ts';
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

const LONG = 'nội dung đủ dài để git nhận ra đổi tên\ndòng hai\ndòng ba\n';

/** a.txt tạo → đổi tên thành b.txt → sửa b.txt. */
async function openStore() {
  const test = await openTestPort((git, root) => {
    writeFileSync(join(root, 'a.txt'), LONG);
    git('add', '.');
    git('commit', '-q', '-m', 'Tạo a');
    git('mv', 'a.txt', 'b.txt');
    git('commit', '-q', '-m', 'Đổi tên');
    writeFileSync(join(root, 'b.txt'), `${LONG}dòng bốn\n`);
    git('commit', '-q', '-am', 'Sửa b');
  });
  cleanups.push(() => test.cleanup());
  const prefs = new PrefsStore(null);
  const toasts = new ToastStore();
  const store = new RepoStore(test.port, { prefs, toasts, detailsDelayMs: 0, clipboard: async () => {} });
  cleanups.push(() => store.dispose());
  await store.start();
  await until(() => store.hasLoaded, 'nạp xong');
  return { test, store, toasts };
}

function titles(items: readonly MenuItem[]): string[] {
  return items.flatMap((item) => (item.kind === 'separator' ? [] : [item.title]));
}

describe('FileHistoryStore', () => {
  it('liệt kê commit theo dấu đổi tên; chọn commit mở diff của đúng file đó; mở Dòng thời gian thì đóng panel', async () => {
    const { store } = await openStore();
    const history = store.fileHistory;
    openFileHistory(store, 'b.txt');
    expect(history.isOpen).toBe(true);
    await until(() => !history.loading && history.entries.length > 0, 'đọc lịch sử');
    expect(history.entries.map((entry) => entry.commit.subject)).toEqual(['Sửa b', 'Đổi tên', 'Tạo a']);
    expect(history.entries.map((entry) => entry.change.path)).toEqual(['b.txt', 'b.txt', 'a.txt']);

    const created = history.entries[2]!;
    history.select(created);
    expect(store.diff.file?.change).toEqual({ path: 'a.txt', kind: 'added' });
    expect(store.diff.file?.source).toEqual({ kind: 'commit', sha: created.commit.id, parent: null });

    store.timeline.open();
    expect(history.isOpen).toBe(false);
    expect(store.diff.file).toBeNull();
    openFileHistory(store, 'b.txt');
    expect(store.timeline.isOpen).toBe(false);
  });

  it('"Xem trên graph" đóng panel và blame rồi chọn commit', async () => {
    const { store } = await openStore();
    openFileHistory(store, 'b.txt');
    await until(() => store.fileHistory.entries.length === 3, 'đọc lịch sử');
    const renamed = store.fileHistory.entries[1]!;
    openBlame(store, 'b.txt', null);
    showCommitInGraph(store, renamed.commit.id);
    expect(store.fileHistory.isOpen).toBe(false);
    expect(store.blame.target).toBeNull();
    expect(store.selection).toEqual({ kind: 'commit', sha: renamed.commit.id });
  });
});

describe('BlameStore', () => {
  it('blame bản đang sửa (dòng chưa commit riêng) và tại một commit cũ; mở blame thì đóng diff', async () => {
    const { test, store } = await openStore();
    await test.write('b.txt', `${LONG}dòng bốn\nchưa commit\n`);
    store.diff.open({ path: 'b.txt', kind: 'modified' }, { kind: 'unstaged' });
    openBlame(store, 'b.txt', null);
    expect(store.diff.file).toBeNull();
    await until(() => store.blame.state.kind !== 'loading', 'blame xong');
    const state = store.blame.state;
    if (state.kind !== 'ready') throw new Error(`blame lỗi: ${state.kind}`);
    expect(state.blame.lines.map((line) => line.text)).toEqual([
      'nội dung đủ dài để git nhận ra đổi tên',
      'dòng hai',
      'dòng ba',
      'dòng bốn',
      'chưa commit',
    ]);
    expect(isUncommittedBlame(state.blame.lines[4]!.sha)).toBe(true);
    const created = state.blame.commits.get(state.blame.lines[0]!.sha);
    expect(created?.summary).toBe('Tạo a');

    openFileHistory(store, 'b.txt');
    await until(() => store.fileHistory.entries.length === 3, 'đọc lịch sử');
    const first = store.fileHistory.entries[2]!;
    openBlame(store, first.change.path, first.commit.id);
    await until(() => store.blame.state.kind === 'ready', 'blame commit cũ');
    const old = store.blame.state;
    if (old.kind !== 'ready') throw new Error('blame lỗi');
    expect(old.blame.lines).toHaveLength(3);
  });

  it('file không có trong repo: báo câu thân thiện, không lộ lỗi gốc của git', async () => {
    const { store } = await openStore();
    openBlame(store, 'không-có.txt', null);
    await until(() => store.blame.state.kind !== 'loading', 'blame xong');
    const state = store.blame.state;
    expect(state.kind).toBe('failed');
    if (state.kind === 'failed') {
      expect(state.message).not.toMatch(/fatal|no such path/i);
    }
  });
});

describe('menu file: Lịch sử file / Blame', () => {
  it('file đã commit có cả hai; file mới / chưa track / trong stash không có; file đã xoá không blame', async () => {
    const { store } = await openStore();
    const history = strings.history;
    expect(titles(fileMenu(store, { path: 'b.txt', kind: 'modified' }, { kind: 'unstaged' }))).toEqual(
      expect.arrayContaining([history.menuFileHistory, history.menuBlame]),
    );
    const commit = { kind: 'commit', sha: 'a'.repeat(40), parent: null } as const;
    const atCommit = titles(fileMenu(store, { path: 'b.txt', kind: 'modified' }, commit));
    expect(atCommit).toEqual(expect.arrayContaining([history.menuFileHistory, history.menuBlameAtCommit]));
    expect(atCommit).not.toContain(history.menuBlame);
    const deleted = titles(fileMenu(store, { path: 'a.txt', kind: 'deleted' }, commit));
    expect(deleted).toContain(history.menuFileHistory);
    expect(deleted).not.toContain(history.menuBlameAtCommit);
    for (const [change, source] of [
      [{ path: 'moi.txt', kind: 'untracked' }, { kind: 'unstaged' }],
      [{ path: 'moi.txt', kind: 'added' }, { kind: 'staged' }],
      [
        { path: 'b.txt', kind: 'modified' },
        { kind: 'stash', sha: 'a'.repeat(40) },
      ],
    ] as const) {
      const items = titles(fileMenu(store, change, source));
      expect(items).not.toContain(history.menuFileHistory);
      expect(items).not.toContain(history.menuBlame);
    }
  });
});
