// Merge / xung đột / cherry-pick / revert / reset / nhánh / tag / huỷ tất cả / menu chuột phải — trên repo git thật.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { conflictAsChange, type Commit, type GitRef } from '@thaigit/core';
import { commit } from '../src/lib/actions/commit.ts';
import { resolveWhole, saveResolution } from '../src/lib/actions/conflicts.ts';
import { beginRenameBranch, deleteBranch } from '../src/lib/actions/branches.ts';
import {
  abortOperation,
  cherryPick,
  continueOperation,
  discardAll,
  merge,
  rebaseCurrent,
  reset,
  revert,
} from '../src/lib/actions/history.ts';
import { commitMenu, fileMenu, refMenu } from '../src/lib/actions/menus.ts';
import { beginCreateTag, deleteTag } from '../src/lib/actions/tags.ts';
import { DialogStore } from '../src/lib/stores/dialogs.svelte.ts';
import { isMenuAction, type MenuItem } from '../src/lib/stores/menus.svelte.ts';
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

interface Fixture {
  test: TestPort;
  store: RepoStore;
  toasts: ToastStore;
  dialogs: DialogStore;
}

/**
 * main: base ← "main sửa a" ; feature: base ← "feature sửa a" ← "feature thêm f" (a.txt sửa khác nhau ở hai nhánh →
 * merge feature vào main xung đột). Nhánh `gon` đã merge vào main.
 */
async function openBranchy(): Promise<Fixture> {
  const test = await openTestPort((git, root) => {
    writeFileSync(join(root, 'a.txt'), 'một\nhai\nba\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    git('branch', 'gon');
    git('switch', '-q', '-c', 'feature');
    writeFileSync(join(root, 'a.txt'), 'một\nHAI (feature)\nba\n');
    git('commit', '-q', '-am', 'feature sửa a');
    writeFileSync(join(root, 'f.txt'), 'f\n');
    git('add', '.');
    git('commit', '-q', '-m', 'feature thêm f');
    git('switch', '-q', 'main');
    writeFileSync(join(root, 'a.txt'), 'một\nHAI (main)\nba\n');
    git('commit', '-q', '-am', 'main sửa a');
  });
  cleanups.push(() => test.cleanup());
  const toasts = new ToastStore();
  const store = new RepoStore(test.port, { prefs: new PrefsStore(null), toasts, detailsDelayMs: 0, clipboard: async () => {} });
  cleanups.push(() => store.dispose());
  await store.start();
  await until(() => store.hasLoaded && store.localBranches.length === 3, 'nạp xong');
  return { test, store, toasts, dialogs: new DialogStore() };
}

function action(toasts: ToastStore, title: string): () => void {
  const toast = [...toasts.items].reverse().find((item) => item.actions.some((candidate) => candidate.title === title));
  const found = toast?.actions.find((candidate) => candidate.title === title);
  if (!found) throw new Error(`Không thấy nút “${title}” (toast: ${toasts.items.map((item) => item.title).join(' | ')})`);
  return found.run;
}

function lastToast(toasts: ToastStore): string {
  return toasts.items.at(-1)?.title ?? '';
}

async function answer(dialogs: DialogStore, result: 'confirm' | 'secondary' | 'cancel'): Promise<void> {
  await until(() => dialogs.current !== null, 'hộp thoại');
  dialogs.answer(result);
}

function commitBySubject(store: RepoStore, subject: string): Commit {
  const found = store.entries.find((entry) => entry.commit.subject === subject)?.commit;
  if (!found) throw new Error(`Không thấy commit “${subject}”`);
  return found;
}

function ref(store: RepoStore, fullName: string): GitRef {
  const found = store.refs.find((candidate) => candidate.fullName === fullName);
  if (!found) throw new Error(`Không thấy ${fullName}`);
  return found;
}

function titles(items: readonly MenuItem[]): string[] {
  return items.map((item) => (item.kind === 'separator' ? '—' : item.title));
}

describe('merge và giải xung đột', () => {
  it('merge xung đột → giải từng đoạn → commit merge', async () => {
    const { test, store, toasts } = await openBranchy();
    await merge(store, 'feature', 'feature');
    expect(lastToast(toasts)).toBe('Merge gặp xung đột');
    expect(store.operation).toEqual({ kind: 'merging' });
    expect(store.status.conflicts.map((entry) => entry.path)).toEqual(['a.txt']);
    await until(() => store.commitDraft.summary.startsWith("Merge branch 'feature'"), 'điền sẵn message merge');

    const entry = store.status.conflicts[0]!;
    store.diff.open(conflictAsChange(entry), { kind: 'conflict' });
    await until(() => store.diff.state.kind === 'conflict', 'nạp file xung đột');
    const view = store.diff.state;
    if (view.kind !== 'conflict') throw new Error('không phải xung đột');
    expect(view.file.blocks).toHaveLength(1);
    expect(view.file.blocks[0]?.ours).toEqual(['HAI (main)']);
    expect(view.file.blocks[0]?.theirs).toEqual(['HAI (feature)']);

    await saveResolution(store, view.entry, view.file, view.sha256, new Map([[0, 'oursThenTheirs']]));
    expect(readFileSync(join(test.root, 'a.txt'), 'utf8')).toBe('một\nHAI (main)\nHAI (feature)\nba\n');
    expect(store.status.conflicts).toHaveLength(0);
    // Đã giải xong: trình giải tự đóng.
    await until(() => store.diff.file === null, 'đóng trình giải');

    await commit(store);
    expect(store.operation).toBeNull();
    expect(test.git('log', '-1', '--format=%P').trim().split(' ')).toHaveLength(2);
  });

  it('file bị sửa bên ngoài trong lúc giải: không ghi đè, nạp lại', async () => {
    const { test, store, toasts } = await openBranchy();
    await merge(store, 'feature', 'feature');
    store.diff.open(conflictAsChange(store.status.conflicts[0]!), { kind: 'conflict' });
    await until(() => store.diff.state.kind === 'conflict', 'nạp file xung đột');
    const view = store.diff.state;
    if (view.kind !== 'conflict') throw new Error('không phải xung đột');
    const edited = readFileSync(join(test.root, 'a.txt'), 'utf8').replace('ba', 'BA');
    writeFileSync(join(test.root, 'a.txt'), edited);

    await saveResolution(store, view.entry, view.file, view.sha256, new Map([[0, 'ours']]));
    expect(lastToast(toasts)).toBe('File đã bị sửa bên ngoài — đã nạp lại, hãy chọn lại');
    expect(readFileSync(join(test.root, 'a.txt'), 'utf8')).toBe(edited);
    expect(store.status.conflicts).toHaveLength(1);
  });

  it('dùng toàn bộ một phía; huỷ merge qua banner', async () => {
    const { test, store, dialogs } = await openBranchy();
    await merge(store, 'feature', 'feature');
    await resolveWhole(store, store.status.conflicts[0]!, false);
    expect(readFileSync(join(test.root, 'a.txt'), 'utf8')).toBe('một\nHAI (feature)\nba\n');
    expect(store.status.conflicts).toHaveLength(0);

    const aborting = abortOperation(store, dialogs);
    await answer(dialogs, 'confirm');
    await aborting;
    expect(store.operation).toBeNull();
    expect(readFileSync(join(test.root, 'a.txt'), 'utf8')).toBe('một\nHAI (main)\nba\n');
    expect(existsSync(join(test.root, 'f.txt'))).toBe(false);
  });

  it('merge không xung đột rồi hoàn tác', async () => {
    const { test, store, toasts } = await openBranchy();
    const before = store.headOid;
    await merge(store, 'gon', 'gon');
    expect(lastToast(toasts)).toBe('Đã merge gon vào main');
    test.git('switch', '-q', 'gon');
    await store.refreshAndWait(7);
    await writeAndCommit(test, store, 'g.txt', 'g\n', 'gon thêm g');
    test.git('switch', '-q', 'main');
    await store.refreshAndWait(7);
    await merge(store, 'gon', 'gon');
    expect(existsSync(join(test.root, 'g.txt'))).toBe(true);
    action(toasts, 'Hoàn tác')();
    await until(() => store.headOid === before, 'hoàn tác merge');
    expect(existsSync(join(test.root, 'g.txt'))).toBe(false);
  });
});

async function writeAndCommit(test: TestPort, store: RepoStore, file: string, content: string, message: string): Promise<void> {
  await test.write(file, content);
  test.git('add', '.');
  test.git('commit', '-q', '-m', message);
  await store.refreshAndWait(7);
}

describe('cherry-pick / revert / reset / rebase', () => {
  it('cherry-pick commit của nhánh khác rồi hoàn tác', async () => {
    const { test, store, toasts } = await openBranchy();
    const before = store.headOid;
    await cherryPick(store, commitBySubject(store, 'feature thêm f'));
    expect(lastToast(toasts)).toBe('Đã cherry-pick “feature thêm f”');
    expect(readFileSync(join(test.root, 'f.txt'), 'utf8')).toBe('f\n');
    action(toasts, 'Hoàn tác')();
    await until(() => store.headOid === before, 'hoàn tác cherry-pick');
  });

  it('revert & commit; revert chưa commit (trạng thái "Đang revert", huỷ được)', async () => {
    const { test, store, toasts, dialogs } = await openBranchy();
    const target = commitBySubject(store, 'main sửa a');
    const reverting = revert(store, target, dialogs);
    await answer(dialogs, 'confirm');
    await reverting;
    expect(test.git('log', '-1', '--format=%s').trim()).toBe('Revert "main sửa a"');
    expect(readFileSync(join(test.root, 'a.txt'), 'utf8')).toBe('một\nhai\nba\n');
    action(toasts, 'Hoàn tác')();
    await until(() => store.entries.some((entry) => entry.commit.subject === 'main sửa a') && store.headOid === target.id, 'hoàn tác revert');

    const staging = revert(store, target, dialogs);
    await answer(dialogs, 'secondary');
    await staging;
    expect(store.operation).toEqual({ kind: 'reverting' });
    expect(store.headOid).toBe(target.id);
    expect(store.status.staged.map((change) => change.path)).toEqual(['a.txt']);
    await until(() => store.commitDraft.summary === 'Revert "main sửa a"', 'điền sẵn message revert');
    action(toasts, 'Hoàn tác')();
    await until(() => store.operation === null && store.status.staged.length === 0, 'huỷ revert');
  });

  it('reset mixed / hard (hỏi trước) và hoàn tác', async () => {
    const { test, store, toasts, dialogs } = await openBranchy();
    const head = store.headOid;
    const base = commitBySubject(store, 'base');
    await reset(store, base, 'mixed', dialogs);
    expect(store.headOid).toBe(base.id);
    expect(store.status.unstaged.map((change) => change.path)).toEqual(['a.txt']);
    action(toasts, 'Hoàn tác')();
    await until(() => store.headOid === head, 'hoàn tác reset mixed');

    const cancelled = reset(store, base, 'hard', dialogs);
    await answer(dialogs, 'cancel');
    await cancelled;
    expect(store.headOid).toBe(head);
    const hard = reset(store, base, 'hard', dialogs);
    await answer(dialogs, 'confirm');
    await hard;
    expect(readFileSync(join(test.root, 'a.txt'), 'utf8')).toBe('một\nhai\nba\n');
    action(toasts, 'Hoàn tác')();
    await until(() => store.headOid === head, 'hoàn tác reset cứng');
    expect(readFileSync(join(test.root, 'a.txt'), 'utf8')).toBe('một\nHAI (main)\nba\n');
  });

  it('rebase gặp xung đột: banner Tiếp tục bị chặn tới khi giải xong', async () => {
    const { store, toasts, dialogs } = await openBranchy();
    const rebasing = rebaseCurrent(store, 'feature', 'feature', dialogs);
    await answer(dialogs, 'confirm');
    await rebasing;
    expect(lastToast(toasts)).toBe('Rebase gặp xung đột');
    expect(store.operation?.kind).toBe('rebasing');
    await continueOperation(store);
    expect(lastToast(toasts)).toBe('Còn 1 file xung đột chưa giải quyết');
    // Khi rebase, "Current" (ours) là nhánh đích (feature): giữ thay đổi của main là chọn Incoming.
    await resolveWhole(store, store.status.conflicts[0]!, false);
    await continueOperation(store);
    expect(store.operation).toBeNull();
    expect(store.entries.slice(0, 3).map((entry) => entry.commit.subject)).toEqual([
      'main sửa a',
      'feature thêm f',
      'feature sửa a',
    ]);
  });
});

describe('nhánh / tag / huỷ tất cả', () => {
  it('xoá nhánh đã merge + hoàn tác; nhánh chưa merge cần "Vẫn xoá"', async () => {
    const { store, toasts, dialogs } = await openBranchy();
    const gone = ref(store, 'refs/heads/gon');
    const deleting = deleteBranch(store, gone, dialogs);
    await answer(dialogs, 'confirm');
    await deleting;
    expect(store.localBranches.map((item) => item.fullName)).not.toContain('refs/heads/gon');
    action(toasts, 'Hoàn tác')();
    await until(() => store.localBranches.some((item) => item.fullName === 'refs/heads/gon'), 'khôi phục nhánh');

    const feature = ref(store, 'refs/heads/feature');
    const deletingFeature = deleteBranch(store, feature, dialogs);
    await answer(dialogs, 'confirm');
    await deletingFeature;
    expect(lastToast(toasts)).toBe('Nhánh feature có commit chưa được merge');
    action(toasts, 'Vẫn xoá')();
    await until(() => !store.localBranches.some((item) => item.fullName === 'refs/heads/feature'), 'xoá hẳn');
  });

  it('đổi tên nhánh + hoàn tác', async () => {
    const { store, toasts, dialogs } = await openBranchy();
    const renaming = beginRenameBranch(store, ref(store, 'refs/heads/gon'), dialogs);
    await until(() => dialogs.current?.kind === 'form', 'form đổi tên');
    dialogs.submit({ name: 'feature' });
    expect(dialogs.current).not.toBeNull();
    dialogs.submit({ name: 'da-doi-ten' });
    await renaming;
    expect(lastToast(toasts)).toBe('Đã đổi tên gon → da-doi-ten');
    action(toasts, 'Hoàn tác')();
    await until(() => store.localBranches.some((item) => item.fullName === 'refs/heads/gon'), 'hoàn tác đổi tên');
  });

  it('tạo tag annotated qua form, xoá rồi hoàn tác', async () => {
    const { test, store, toasts, dialogs } = await openBranchy();
    const head = store.headOid!;
    const creating = beginCreateTag(store, head, head.slice(0, 7), dialogs);
    await until(() => dialogs.current?.kind === 'form', 'form tag');
    const form = dialogs.current;
    // Repo không có remote: không có ô "Push tag lên …".
    expect(form?.kind === 'form' && form.fields.map((field) => field.id)).toEqual(['name', 'message']);
    dialogs.submit({ name: 'v1.0', message: 'Bản đầu' });
    await creating;
    expect(lastToast(toasts)).toBe('Đã tạo tag v1.0');
    expect(test.git('cat-file', '-t', 'v1.0').trim()).toBe('tag');

    const deleting = deleteTag(store, ref(store, 'refs/tags/v1.0'), dialogs);
    await answer(dialogs, 'confirm');
    await deleting;
    expect(store.tags).toHaveLength(0);
    action(toasts, 'Hoàn tác')();
    await until(() => store.tags.length === 1, 'khôi phục tag');
    expect(test.git('cat-file', '-t', 'v1.0').trim()).toBe('tag');
  });

  it('huỷ tất cả thay đổi (đã stage, chưa stage, file mới) rồi hoàn tác', async () => {
    const { test, store, toasts, dialogs } = await openBranchy();
    await test.write('a.txt', 'đã stage\n');
    test.git('add', 'a.txt');
    await test.write('a.txt', 'chưa stage\n');
    await test.write('moi.txt', 'mới\n');
    await store.refreshAndWait(7);

    const discarding = discardAll(store, dialogs);
    await answer(dialogs, 'confirm');
    await discarding;
    expect(store.status.staged).toHaveLength(0);
    expect(store.status.unstaged).toHaveLength(0);
    expect(existsSync(join(test.root, 'moi.txt'))).toBe(false);

    action(toasts, 'Hoàn tác')();
    await until(() => existsSync(join(test.root, 'moi.txt')) && store.status.staged.length === 1, 'hoàn tác huỷ tất cả');
    expect(readFileSync(join(test.root, 'a.txt'), 'utf8')).toBe('chưa stage\n');
    expect(test.git('show', ':a.txt')).toBe('đã stage\n');
  });
});

describe('menu chuột phải', () => {
  it('commit có nhánh: menu con cho từng nhánh, cherry-pick tắt trên HEAD', async () => {
    const { store } = await openBranchy();
    const featureTip = store.entries.find((entry) => entry.commit.subject === 'feature thêm f')!;
    const items = commitMenu(store, featureTip);
    expect(items[0]).toMatchObject({ kind: 'submenu', title: 'feature' });
    const sub = items[0]!.kind === 'submenu' ? items[0]!.items : [];
    expect(titles(sub).slice(0, 4)).toEqual(['Checkout feature', 'Merge feature vào main', 'Rebase main lên feature', 'Push feature']);

    const headEntry = store.entries.find((entry) => entry.commit.id === store.headOid)!;
    const headItems = commitMenu(store, headEntry);
    const pick = headItems.find((item) => item.kind !== 'separator' && item.title.startsWith('Cherry-pick'));
    expect(pick && isMenuAction(pick) && pick.disabled).toBe(true);
  });

  it('nhánh hiện tại: Pull / Push, không xoá được', async () => {
    const { store } = await openBranchy();
    const items = refMenu(store, ref(store, 'refs/heads/main'));
    expect(titles(items).slice(0, 2)).toEqual(['Pull', 'Push']);
    const remove = items.find((item) => item.kind !== 'separator' && item.title === 'Xoá nhánh…');
    expect(remove && isMenuAction(remove) && remove.disabled).toBe(true);
  });

  it('file mới: menu con .gitignore thêm đúng mẫu', async () => {
    const { test, store } = await openBranchy();
    await test.write('build.log', 'x\n');
    await store.refreshAndWait(7);
    const change = store.status.unstaged.find((item) => item.path === 'build.log')!;
    const items = fileMenu(store, change, { kind: 'unstaged' });
    const ignoreMenu = items.find((item) => item.kind === 'submenu');
    expect(ignoreMenu?.kind === 'submenu' && titles(ignoreMenu.items)).toEqual(['Bỏ qua file này', 'Bỏ qua mọi file *.log']);
    const byExtension = ignoreMenu?.kind === 'submenu' ? ignoreMenu.items[1] : undefined;
    if (!byExtension || !isMenuAction(byExtension)) throw new Error('thiếu mục');
    byExtension.run();
    await until(() => store.status.unstaged.every((item) => item.path !== 'build.log'), '.gitignore có hiệu lực');
    expect(readFileSync(join(test.root, '.gitignore'), 'utf8')).toContain('*.log');
  });
});
