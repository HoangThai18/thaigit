// App.svelte: nút "Xem lại cấu hình repo" trên toast chỉ được tác động lên repo ĐANG mở; toast của repo đã đóng thì gỡ luôn.
// RepoWindow được thay bằng bản giả (chỉ lấy `store`/`onclose`): kiểm phần keo của App, không dựng cả cửa sổ repo.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecRequest } from '@thaigit/core';
import type { Host, RepoPort } from '../../src/lib/platform/host.ts';
import { toasts } from '../../src/lib/stores/toasts.svelte.ts';
import { openTestPort } from '../helpers/node-port.ts';

const hoisted = vi.hoisted(() => ({
  window: { props: null as null | { store: { port: unknown }; onclose: () => Promise<void> } },
  host: null as null | Host,
}));

vi.mock('../../src/lib/shell/RepoWindow.svelte', () => ({
  default: (_anchor: unknown, props: { store: { port: unknown }; onclose: () => Promise<void> }) => {
    hoisted.window.props = props;
  },
}));

vi.mock('../../src/lib/platform/host.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/host.ts')>()),
  resolveHost: async () => hoisted.host,
}));

const { default: App } = await import('../../src/App.svelte');

const cleanups: (() => Promise<void> | void)[] = [];
beforeEach(() => {
  hoisted.window.props = null;
  toasts.clear();
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  toasts.clear();
});

async function until(condition: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Hết giờ chờ: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Mở App với một repo mà lõi từ chối `status` vì `untrusted`; trả port, hàm trust giả và hàm dọn. */
async function openUntrustedApp(): Promise<{ port: RepoPort; trust: ReturnType<typeof vi.fn> }> {
  const test = await openTestPort((git) => git('commit', '-q', '--allow-empty', '-m', 'a'));
  cleanups.push(() => test.cleanup());
  const trust = vi.fn(async () => port);
  const port: RepoPort = {
    ...test.port,
    exec: {
      run: (request: ExecRequest) =>
        request.sub === 'status'
          ? Promise.reject(Object.assign(new Error('repo chưa được tin tưởng'), { code: 'untrusted' }))
          : test.port.exec.run(request),
    },
    trust,
  };
  hoisted.host = {
    kind: 'dev-bridge',
    pickAndOpenRepo: async () => null,
    openRecent: async () => port,
    listRecentRepos: async () => [],
    forgetRecentRepo: async () => {},
    openLaunchRepo: async () => port,
  };
  const target = document.createElement('div');
  document.body.append(target);
  const app = mount(App, { target });
  cleanups.push(() => {
    unmount(app);
    target.remove();
  });
  await until(() => hoisted.window.props !== null, 'App vào cửa sổ repo');
  await until(() => toasts.items.some((toast) => toast.style === 'warning'), 'cảnh báo untrusted');
  return { port, trust };
}

describe('App: toast "Xem lại cấu hình repo"', () => {
  it('repo đang mở: bấm nút hỏi tin tưởng lại qua port của repo đó', async () => {
    const { trust } = await openUntrustedApp();
    const action = toasts.items.find((toast) => toast.style === 'warning')?.actions[0];
    expect(action?.title).toBe('Xem lại cấu hình repo');
    action?.run();
    await until(() => trust.mock.calls.length > 0, 'gọi port.trust');
    expect(trust).toHaveBeenCalledOnce();
  });

  it('đóng repo: toast của repo đó biến mất, và nút cũ (bấm trễ) không kéo app quay lại repo đã đóng', async () => {
    const { trust } = await openUntrustedApp();
    const stale = toasts.items.find((toast) => toast.style === 'warning')?.actions[0];
    expect(stale).toBeDefined();
    const props = hoisted.window.props!;
    await props.onclose();
    flushSync();

    expect(toasts.items.filter((toast) => toast.style === 'warning')).toEqual([]);
    const before = hoisted.window.props;
    stale?.run();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(trust).not.toHaveBeenCalled();
    expect(hoisted.window.props).toBe(before);
  });
});
