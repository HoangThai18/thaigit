// Stage / unstage / discard by file, hunk, line, plus commit / undo — on a real git repo (core's Node adapter).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canCommit, commit, composeMessage, splitMessage } from '../src/lib/actions/commit.ts';
import { applyToSelection, discardFiles, stageFiles, unstageFiles } from '../src/lib/actions/staging.ts';
import { DialogStore } from '../src/lib/stores/dialogs.svelte.ts';
import { PrefsStore } from '../src/lib/stores/prefs.svelte.ts';
import { RepoStore } from '../src/lib/stores/repo.svelte.ts';
import { ToastStore } from '../src/lib/stores/toasts.svelte.ts';
import { openTestPort, type TestPort } from './helpers/node-port.ts';

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

async function openStore(
  setup: Parameters<typeof openTestPort>[0],
): Promise<{ test: TestPort; store: RepoStore; toasts: ToastStore }> {
  const test = await openTestPort(setup);
  cleanups.push(() => test.cleanup());
  const toasts = new ToastStore();
  const store = new RepoStore(test.port, {
    prefs: new PrefsStore(null),
    toasts,
    detailsDelayMs: 0,
    clipboard: async () => {},
  });
  cleanups.push(() => store.dispose());
  await store.start();
  await until(() => store.hasLoaded, 'nạp xong');
  return { test, store, toasts };
}

const LINES = ['một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín', 'mười'];

/** a.txt committed with 10 lines. */
function setupTenLines(git: (...args: string[]) => string, root: string): void {
  writeFileSync(join(root, 'a.txt'), `${LINES.join('\n')}\n`);
  git('add', '.');
  git('commit', '-q', '-m', 'Khởi tạo');
}

/** Answer the next confirmation dialog. */
async function answerNext(dialogs: DialogStore, result: 'confirm' | 'cancel'): Promise<void> {
  await until(() => dialogs.current !== null, 'hộp xác nhận');
  dialogs.answer(result);
}

function lastAction(toasts: ToastStore, title: string): () => void {
  const toast = [...toasts.items]
    .reverse()
    .find((item) => item.actions.some((action) => action.title === title));
  const action = toast?.actions.find((candidate) => candidate.title === title);
  if (!action) throw new Error(`Không thấy nút “${title}”`);
  return action.run;
}

describe('message commit', () => {
  it('ghép và tách tóm tắt + mô tả', () => {
    expect(composeMessage('  Sửa lỗi  ', '')).toBe('Sửa lỗi');
    expect(composeMessage('Sửa lỗi', '\nChi tiết\n')).toBe('Sửa lỗi\n\nChi tiết');
    expect(splitMessage('Sửa lỗi\r\n\r\nDòng 1\r\nDòng 2\r\n')).toEqual({
      summary: 'Sửa lỗi',
      body: 'Dòng 1\nDòng 2',
    });
    expect(splitMessage('Một dòng')).toEqual({ summary: 'Một dòng', body: '' });
  });
});

describe('stage theo dòng / hunk', () => {
  it('stage riêng các dòng đã chọn, rồi bỏ stage cả hunk', async () => {
    const { test, store } = await openStore(setupTenLines);
    const changed = [...LINES];
    changed[1] = 'HAI';
    changed[7] = 'TÁM';
    await test.write('a.txt', `${changed.join('\n')}\n`);
    await store.refreshAndWait(1);
    const change = store.status.unstaged.find((item) => item.path === 'a.txt');
    expect(change).toBeDefined();

    store.diff.open(change!, { kind: 'unstaged' });
    await until(() => store.diff.state.kind === 'text', 'diff chưa stage');
    expect(store.diff.supportsPartial).toBe(true);
    const hunk = store.diff.fileDiff!.hunks[0]!;
    // Pick the −two / +HAI pair (skipping −tám / +TÁM).
    hunk.lines.forEach((line, index) => {
      const text = new TextDecoder().decode(line.text);
      if ((line.kind === 'deletion' && text === 'hai') || (line.kind === 'addition' && text === 'HAI')) {
        store.diff.toggleLine(hunk.id, index);
      }
    });
    expect(store.diff.selectedCount).toBe(2);

    await applyToSelection(store, 'stage');
    expect(store.diff.selectedCount).toBe(0);
    const cached = test.git('diff', '--cached', '--', 'a.txt');
    expect(cached).toContain('-hai');
    expect(cached).toContain('+HAI');
    expect(cached).not.toContain('TÁM');
    const working = test.git('diff', '--', 'a.txt');
    expect(working).toContain('+TÁM');
    expect(working).not.toContain('HAI');

    // An open (unstaged) diff reloads itself after the status changes: only the line-8 change is left.
    await until(() => {
      const diff = store.diff.fileDiff;
      return diff !== null && diff.additions === 1 && diff.deletions === 1;
    }, 'diff chưa stage nạp lại');

    const staged = store.status.staged.find((item) => item.path === 'a.txt')!;
    store.diff.open(staged, { kind: 'staged' });
    await until(
      () => store.diff.state.kind === 'text' && store.diff.file?.source.kind === 'staged',
      'diff đã stage',
    );
    await applyToSelection(store, 'unstage', { hunkId: 0 });
    expect(test.git('diff', '--cached', '--name-only')).toBe('');
    // Nothing left staged: the "staged" diff closes itself.
    await until(() => store.diff.file === null, 'đóng diff đã stage');
    expect(readFileSync(join(test.root, 'a.txt'), 'utf8')).toBe(`${changed.join('\n')}\n`);
  });

  it('huỷ một hunk hỏi trước, có hoàn tác', async () => {
    const { test, store, toasts } = await openStore(setupTenLines);
    const changed = [...LINES];
    changed[0] = 'MỘT';
    changed[9] = 'MƯỜI';
    await test.write('a.txt', `${changed.join('\n')}\n`);
    await store.refreshAndWait(1);
    store.diff.open(store.status.unstaged[0]!, { kind: 'unstaged' });
    await until(() => store.diff.state.kind === 'text', 'diff');
    // 3 lines of context: line 1 and line 10 land in two different hunks.
    expect(store.diff.fileDiff!.hunks).toHaveLength(2);

    const dialogs = new DialogStore();
    const cancelled = applyToSelection(store, 'discard', { hunkId: 0, dialogs });
    await answerNext(dialogs, 'cancel');
    await cancelled;
    expect(readFileSync(join(test.root, 'a.txt'), 'utf8')).toBe(`${changed.join('\n')}\n`);

    const discarded = applyToSelection(store, 'discard', { hunkId: 0, dialogs });
    await answerNext(dialogs, 'confirm');
    await discarded;
    const afterDiscard = [...LINES];
    afterDiscard[9] = 'MƯỜI';
    expect(readFileSync(join(test.root, 'a.txt'), 'utf8')).toBe(`${afterDiscard.join('\n')}\n`);

    lastAction(toasts, 'Hoàn tác')();
    // `git apply` deletes then recreates the file: reading it at that moment hits ENOENT — treat that as "not finished", not an error.
    const current = (): string | null => {
      try {
        return readFileSync(join(test.root, 'a.txt'), 'utf8');
      } catch {
        return null;
      }
    };
    await until(() => current() === `${changed.join('\n')}\n`, 'hoàn tác huỷ hunk');
  });
});

describe('stage / huỷ theo file', () => {
  it('stage, bỏ stage và huỷ (file đã track + file mới) rồi hoàn tác', async () => {
    const { test, store, toasts } = await openStore(setupTenLines);
    await test.write('a.txt', 'đổi hết\n');
    await test.write('moi.txt', 'file mới\n');
    await store.refreshAndWait(1);
    const tracked = store.status.unstaged.find((item) => item.path === 'a.txt')!;
    const untracked = store.status.unstaged.find((item) => item.path === 'moi.txt')!;
    expect(untracked.kind).toBe('untracked');

    await stageFiles(store, [tracked]);
    expect(store.status.staged.map((item) => item.path)).toEqual(['a.txt']);
    await unstageFiles(store, [store.status.staged[0]!]);
    expect(store.status.staged).toHaveLength(0);

    const dialogs = new DialogStore();
    const discarding = discardFiles(store, store.status.unstaged, { dialogs });
    await answerNext(dialogs, 'confirm');
    await discarding;
    expect(readFileSync(join(test.root, 'a.txt'), 'utf8')).toBe(`${LINES.join('\n')}\n`);
    expect(existsSync(join(test.root, 'moi.txt'))).toBe(false);
    expect(store.status.unstaged).toHaveLength(0);

    lastAction(toasts, 'Hoàn tác')();
    await until(() => existsSync(join(test.root, 'moi.txt')), 'trả file mới');
    await until(() => readFileSync(join(test.root, 'a.txt'), 'utf8') === 'đổi hết\n', 'trả file đã track');
    expect(readFileSync(join(test.root, 'moi.txt'), 'utf8')).toBe('file mới\n');
  });
});

describe('duyệt diff liên tục', () => {
  it('stage / huỷ file đang xem thì mở file kế tiếp; hết file thì đóng', async () => {
    const { test, store } = await openStore(setupTenLines);
    await test.write('b.txt', 'b\n');
    await test.write('c.txt', 'c\n');
    await test.write('d.txt', 'd\n');
    await store.refreshAndWait(1);
    expect(store.status.unstaged.map((item) => item.path)).toEqual(['b.txt', 'c.txt', 'd.txt']);

    store.diff.open(store.status.unstaged[1]!, { kind: 'unstaged' });
    expect(store.diff.siblings?.length).toBe(3);
    expect(store.diff.step(1)).toBe(true);
    expect(store.diff.file?.change.path).toBe('d.txt');
    expect(store.diff.step(1)).toBe(false);
    store.diff.step(-1);
    expect(store.diff.file?.change.path).toBe('c.txt');

    // Stage c → open d (positioned right at c); stage d (last in the list) → step back to b.
    await stageFiles(store, [store.diff.file!.change]);
    expect(store.diff.file?.change.path).toBe('d.txt');
    expect(store.diff.file?.source.kind).toBe('unstaged');
    await stageFiles(store, [store.diff.file!.change]);
    expect(store.diff.file?.change.path).toBe('b.txt');

    // Same for the staged list; with an empty list it returns to the graph.
    store.diff.open(store.status.staged[0]!, { kind: 'staged' });
    await unstageFiles(store, store.status.staged);
    expect(store.diff.file).toBeNull();
  });
});

describe('commit', () => {
  it('commit phần đã stage, hoàn tác đưa thay đổi + message về lại', async () => {
    const { test, store, toasts } = await openStore(setupTenLines);
    await test.write('a.txt', 'nội dung mới\n');
    await store.refreshAndWait(1);
    const before = store.headOid;

    store.commitDraft.summary = 'Sửa a';
    expect(canCommit(store)).toEqual({ ok: false, reason: 'Stage thay đổi trước khi commit' });
    await stageFiles(store, store.status.unstaged);
    expect(canCommit(store).ok).toBe(true);
    store.commitDraft.body = 'Chi tiết';

    await commit(store);
    expect(test.git('log', '-1', '--format=%B').trim()).toBe('Sửa a\n\nChi tiết');
    expect(store.headOid).not.toBe(before);
    expect(store.commitDraft.summary).toBe('');
    expect(store.status.staged).toHaveLength(0);

    lastAction(toasts, 'Hoàn tác')();
    await until(() => store.headOid === before && store.status.staged.length === 1, 'hoàn tác commit');
    expect(store.commitDraft.summary).toBe('Sửa a');
    expect(store.commitDraft.body).toBe('Chi tiết');
  });

  it('nút Undo: hoàn tác commit vừa xong; repo đổi khác thì tự tắt', async () => {
    const { test, store } = await openStore(setupTenLines);
    const before = store.headOid;
    await test.write('a.txt', 'sửa\n');
    await store.refreshAndWait(1);
    store.commitDraft.summary = 'Sửa a';
    await commit(store, { stageAllFirst: true });
    expect(store.canUndoLast).toBe(true);
    store.undoLast();
    await until(() => store.headOid === before && !store.isPerforming, 'undo commit');
    expect(store.status.staged.map((change) => change.path)).toEqual(['a.txt']);
    expect(store.canUndoLast).toBe(false);

    // Commit, then edit another file: Undo turns off so it can't clobber the new work.
    store.commitDraft.summary = 'Sửa a lần nữa';
    await commit(store);
    expect(store.canUndoLast).toBe(true);
    await test.write('moi.txt', 'mới\n');
    await store.refreshAndWait(1);
    expect(store.canUndoLast).toBe(false);
  });

  it('"Stage tất cả & commit" và hoàn tác commit đầu tiên', async () => {
    const { test, store, toasts } = await openStore(() => {});
    await test.write('a.txt', 'đầu tiên\n');
    await store.refreshAndWait(1);
    expect(store.headOid).toBeNull();

    store.commitDraft.summary = 'Khởi tạo';
    await commit(store, { stageAllFirst: true });
    expect(test.git('log', '--format=%s').trim()).toBe('Khởi tạo');

    lastAction(toasts, 'Hoàn tác')();
    await until(() => store.headOid === null && store.status.staged.length === 1, 'hoàn tác commit đầu tiên');
    expect(store.commitDraft.summary).toBe('Khởi tạo');
  });
});
