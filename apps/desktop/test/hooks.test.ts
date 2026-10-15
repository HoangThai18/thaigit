import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commit } from '../src/lib/actions/commit.ts';
import { PrefsStore } from '../src/lib/stores/prefs.svelte.ts';
import { RepoStore } from '../src/lib/stores/repo.svelte.ts';
import { ToastStore } from '../src/lib/stores/toasts.svelte.ts';
import { vi } from '../src/lib/strings.vi.ts';
import { openTestPort } from './helpers/node-port.ts';

const IS_WINDOWS = process.platform === 'win32';
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

async function openStore(trust: 'trusted' | 'unknown') {
  const test = await openTestPort((git, root) => {
    git('commit', '-q', '--allow-empty', '-m', 'đầu tiên');
    const hooks = join(root, '.git', 'hooks');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\necho "lint lỗi" >&2\nexit 1\n');
    chmodSync(join(hooks, 'pre-commit'), 0o755);
  });
  cleanups.push(() => test.cleanup());
  const toasts = new ToastStore();
  const port = { ...test.port, info: { ...test.port.info, trust, hooks: ['pre-commit'] } };
  const store = new RepoStore(port, {
    prefs: new PrefsStore(null),
    toasts,
    detailsDelayMs: 0,
    clipboard: async () => {},
  });
  cleanups.push(() => store.dispose());
  await store.start();
  await until(() => store.hasLoaded, 'nạp xong');
  return { store, toasts, test };
}

describe('git hooks', () => {
  it('biết repo có hook nào và hook có chạy không', async () => {
    const trusted = await openStore('trusted');
    expect(trusted.store.hooks).toEqual(['pre-commit']);
    expect(trusted.store.hasVerifyHook('commit')).toBe(true);
    expect(trusted.store.hasVerifyHook('push')).toBe(false);
    const untrusted = await openStore('unknown');
    expect(untrusted.store.hooksRun).toBe(false);
    expect(untrusted.store.hasVerifyHook('commit')).toBe(false);
  });

  it.skipIf(IS_WINDOWS)('hook pre-commit chặn commit → thông báo có nút commit bỏ qua hook', async () => {
    const { store, toasts, test } = await openStore('trusted');
    await test.write('a.txt', 'nội dung');
    test.git('add', 'a.txt');
    await store.refreshAndWait(7);
    store.commitDraft.summary = 'thêm a';
    await commit(store);
    const toast = toasts.items.find((item) => item.title === vi.hooks.commitFailed);
    expect(toast).toBeDefined();
    expect(test.git('log', '-1', '--format=%s').trim()).toBe('đầu tiên');

    const skip = toast?.actions.find((action) => action.title === vi.hooks.commitSkipping);
    expect(skip).toBeDefined();
    skip?.run();
    await until(() => test.git('log', '-1', '--format=%s').trim() === 'thêm a', 'commit bỏ qua hook');
    await until(() => store.commitDraft.summary === '', 'xoá ô soạn');
    expect(store.commitDraft.skipHooks).toBe(false);
  });
});
