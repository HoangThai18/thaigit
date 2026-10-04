import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  beginAddWorktree,
  defaultFolder,
  removeWorktree,
  submoduleMenu,
  worktreeMenu,
  worktreeName,
} from '../src/lib/actions/related.ts';
import { DialogStore } from '../src/lib/stores/dialogs.svelte.ts';
import { isMenuAction } from '../src/lib/stores/menus.svelte.ts';
import { PrefsStore } from '../src/lib/stores/prefs.svelte.ts';
import { RepoStore } from '../src/lib/stores/repo.svelte.ts';
import { ToastStore } from '../src/lib/stores/toasts.svelte.ts';
import { vi as strings } from '../src/lib/strings.vi.ts';
import { openTestPort, rawGit } from './helpers/node-port.ts';

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

async function openStore(setup: (git: (...args: string[]) => string, root: string) => void) {
  const test = await openTestPort(setup);
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
  return { test, store };
}

function titles(items: ReturnType<typeof worktreeMenu>): string[] {
  return items.filter(isMenuAction).map((item) => item.title);
}

describe('worktree', () => {
  it('thêm qua form (kiểm tên nhánh), hiện ở sidebar, gỡ — còn thay đổi thì hỏi gỡ hẳn', async () => {
    const { test, store } = await openStore((git, root) => {
      writeFileSync(join(root, 'a.txt'), '1\n');
      git('add', '.');
      git('commit', '-q', '-m', 'gốc');
      git('branch', 'co-san');
    });
    expect(store.worktrees).toHaveLength(1);
    expect(titles(worktreeMenu(store, store.worktrees[0]!, 0))).not.toContain(strings.related.removeWorktree);

    const parent = await realpath(await mkdtemp(join(tmpdir(), 'thaigit-worktree-')));
    cleanups.push(() => rm(parent, { recursive: true, force: true }));
    const dialogs = new DialogStore();
    const adding = beginAddWorktree(store, {
      dialogs,
      pickFolder: async () => ({ token: parent, name: 'cha', path: parent }),
    });
    await until(() => dialogs.current !== null, 'form thêm worktree');
    const form = dialogs.current;
    if (form?.kind !== 'form') throw new Error('không phải form');
    expect(form.validate?.({ branch: 'co-san', create: true, folder: '' })).toBe(
      strings.related.branchExists('co-san'),
    );
    expect(form.validate?.({ branch: 'chua-co', create: false, folder: '' })).toBe(
      strings.related.branchMissing('chua-co'),
    );
    expect(form.validate?.({ branch: 'main', create: false, folder: '' })).toBe(
      strings.related.branchCheckedOut('main'),
    );
    expect(form.validate?.({ branch: 'a b', create: true, folder: '' })).toBe(strings.related.branchInvalid);
    expect(form.validate?.({ branch: 'moi', create: true, folder: 'a/b' })).toBe(
      strings.related.folderInvalid,
    );
    dialogs.submit({ branch: 'tinh-nang/x', create: true, folder: '' });
    await adding;
    await until(() => store.worktrees.length === 2, 'có worktree mới');
    const added = store.worktrees.find((item) => item.branch === 'tinh-nang/x')!;
    expect(added.path).toBe(join(parent, defaultFolder(store.name, 'tinh-nang/x')));
    expect(worktreeName(added)).toBe('tinh-nang/x');
    expect(titles(worktreeMenu(store, added, 1))).toContain(strings.related.removeWorktree);

    writeFileSync(join(added.path, 'dang-sua.txt'), 'chưa commit\n');
    const removing = removeWorktree(store, added, dialogs);
    await until(() => dialogs.current?.kind === 'confirm', 'hỏi gỡ');
    dialogs.answer('confirm');
    await removing;
    await until(
      () => dialogs.current?.title === strings.related.forceRemoveTitle('tinh-nang/x'),
      'hỏi gỡ hẳn',
    );
    dialogs.answer('confirm');
    await until(() => store.worktrees.length === 1, 'đã gỡ');
    expect(existsSync(added.path)).toBe(false);
    expect(rawGit(test.root, ['branch', '--list', 'tinh-nang/x']).trim()).toBe('tinh-nang/x');
  });
});

describe('submodule', () => {
  it('liệt kê ở sidebar, menu có cập nhật / đồng bộ / sao chép đường dẫn', async () => {
    const lib = await realpath(await mkdtemp(join(tmpdir(), 'thaigit-lib-')));
    cleanups.push(() => rm(lib, { recursive: true, force: true }));
    rawGit(lib, ['init', '-q', '-b', 'main']);
    writeFileSync(join(lib, 'lib.txt'), 'lib\n');
    rawGit(lib, ['add', '.']);
    rawGit(lib, ['-c', 'user.name=T', '-c', 'user.email=t@x', 'commit', '-q', '-m', 'lib']);
    const { store } = await openStore((git, root) => {
      writeFileSync(join(root, 'a.txt'), '1\n');
      git('add', '.');
      git('commit', '-q', '-m', 'gốc');
      git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', lib, 'vendor/lib');
      git('commit', '-q', '-m', 'thêm submodule');
    });
    expect(store.submodules.map((item) => [item.path, item.state])).toEqual([['vendor/lib', 'ok']]);
    const items = submoduleMenu(store, store.submodules[0]!)
      .filter(isMenuAction)
      .map((item) => item.title);
    expect(items).toEqual([
      strings.related.updateSubmodule,
      strings.related.updateAllSubmodules,
      strings.related.syncSubmodules,
      strings.related.copyPath,
    ]);
  });
});
