// Drag and drop: what dropping a branch / tag / file onto a target is allowed to do (a port of Swift's dropOptions), on a real git repo.
import { afterEach, describe, expect, it } from 'vitest';
import { parseDropTarget } from '../src/lib/dnd/drag.svelte.ts';
import { canDrop, dropAction, refDropItems } from '../src/lib/dnd/dropMenu.ts';
import type { MenuItem } from '../src/lib/stores/menus.svelte.ts';
import { PrefsStore } from '../src/lib/stores/prefs.svelte.ts';
import { RepoStore, Scope } from '../src/lib/stores/repo.svelte.ts';
import { ToastStore } from '../src/lib/stores/toasts.svelte.ts';
import { openTestPort } from './helpers/node-port.ts';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const test = await openTestPort((git, root) => {
    writeFileSync(join(root, 'a.txt'), '1\n');
    git('add', '.');
    git('commit', '-q', '-m', 'Khởi tạo');
    git('branch', 'tinh-nang');
    git('tag', 'v1.0');
    git('remote', 'add', 'origin', 'https://example.invalid/repo.git');
    const head = git('rev-parse', 'HEAD').trim();
    git('update-ref', 'refs/remotes/origin/main', head);
    writeFileSync(join(root, 'b.txt'), '2\n');
    git('add', '.');
    git('commit', '-q', '-m', 'Thêm b');
    git('branch', '--set-upstream-to=origin/main', 'main');
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
  await store.refreshAndWait(Scope.all);
  const ref = (fullName: string) => {
    const found = [...store.localBranches, ...store.remoteBranches, ...store.tags].find(
      (item) => item.fullName === fullName,
    );
    if (!found) throw new Error(`không thấy ${fullName}`);
    return found;
  };
  return { test, store, ref };
}

const titles = (items: MenuItem[] | null) =>
  (items ?? []).map((item) => ('title' in item ? item.title : item.kind));

describe('parseDropTarget', () => {
  it('đọc thuộc tính data-drop', () => {
    expect(parseDropTarget('ref:refs/heads/a/b')).toEqual({ kind: 'ref', fullName: 'refs/heads/a/b' });
    expect(parseDropTarget('remote:origin')).toEqual({ kind: 'remote', name: 'origin' });
    expect(parseDropTarget('zone:staged')).toEqual({ kind: 'zone', zone: 'staged' });
    expect(parseDropTarget('zone:khác')).toBeNull();
    expect(parseDropTarget('ref:')).toBeNull();
    expect(parseDropTarget(null)).toBeNull();
  });
});

describe('thả nhánh / tag', () => {
  it('nhánh → nhánh hiện tại: merge + rebase; → nhánh khác: checkout rồi merge', async () => {
    const { store, ref } = await setup();
    const feature = ref('refs/heads/tinh-nang');
    const main = ref('refs/heads/main');
    expect(titles(refDropItems(store, feature, { kind: 'ref', fullName: main.fullName }))).toEqual([
      'Merge tinh-nang vào main',
      'Rebase tinh-nang lên main',
    ]);
    expect(titles(refDropItems(store, main, { kind: 'ref', fullName: feature.fullName }))).toEqual([
      'Checkout tinh-nang rồi merge main vào',
      'Rebase main lên tinh-nang',
    ]);
    expect(refDropItems(store, main, { kind: 'ref', fullName: main.fullName })).toEqual([]);
  });

  it('nhánh → nhánh remote / remote: push; tag → remote: push tag; thả lên tag: không làm gì', async () => {
    const { store, ref } = await setup();
    const main = ref('refs/heads/main');
    expect(titles(refDropItems(store, main, { kind: 'ref', fullName: 'refs/remotes/origin/main' }))).toEqual([
      'Push main lên origin/main',
      'Rebase main lên origin/main',
    ]);
    expect(titles(refDropItems(store, main, { kind: 'remote', name: 'origin' }))).toEqual([
      'Push main lên origin',
    ]);
    const tag = ref('refs/tags/v1.0');
    expect(titles(refDropItems(store, tag, { kind: 'remote', name: 'origin' }))).toEqual([
      'Push tag v1.0 lên origin',
    ]);
    const onTag = refDropItems(store, main, { kind: 'ref', fullName: tag.fullName });
    expect(titles(onTag)).toEqual(['Không có thao tác khi thả lên tag']);
    expect(
      canDrop(store, { kind: 'ref', ref: main, label: 'main' }, { kind: 'ref', fullName: tag.fullName }),
    ).toBe(false);
  });

  it('remote đi trước nhánh local → có fast-forward', async () => {
    const { test, store, ref } = await setup();
    test.git('branch', '-f', 'tinh-nang', 'HEAD~1');
    test.git('branch', '--set-upstream-to=origin/main', 'tinh-nang');
    test.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    await store.refreshAndWait(Scope.all);
    expect(
      titles(
        refDropItems(store, ref('refs/remotes/origin/main'), {
          kind: 'ref',
          fullName: 'refs/heads/tinh-nang',
        }),
      ),
    ).toContain('Fast-forward tinh-nang theo origin/main');
  });
});

describe('thả file', () => {
  it('Chưa stage → Đã stage thì stage ngay; thả lại chỗ cũ không làm gì', async () => {
    const { test, store } = await setup();
    await test.write('a.txt', '1\nmới\n');
    await store.refreshAndWait(Scope.status);
    const change = store.status.unstaged[0];
    if (!change) throw new Error('thiếu thay đổi');
    const payload = { kind: 'files' as const, from: 'unstaged' as const, changes: [change], label: 'a.txt' };
    expect(canDrop(store, payload, { kind: 'zone', zone: 'unstaged' })).toBe(false);
    expect(canDrop(store, payload, { kind: 'zone', zone: 'staged' })).toBe(true);
    expect(canDrop(store, payload, { kind: 'ref', fullName: 'refs/heads/main' })).toBe(false);
    expect(dropAction(store, payload, { kind: 'zone', zone: 'staged' })).toBeNull();
    for (let index = 0; index < 100 && store.status.staged.length === 0; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(store.status.staged.map((item) => item.path)).toEqual(['a.txt']);
  });
});
