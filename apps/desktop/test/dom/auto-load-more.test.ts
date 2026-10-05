// GraphView's "load more when scrolling near the end" effect, running against a real RepoStore on a real git repo.
import { afterEach, describe, expect, it } from 'vitest';
import type { ExecRequest, ExecResult } from '@thaigit/core';
import type { RepoPort } from '../../src/lib/platform/host.ts';
import { PrefsStore } from '../../src/lib/stores/prefs.svelte.ts';
import { RepoStore } from '../../src/lib/stores/repo.svelte.ts';
import { ToastStore } from '../../src/lib/stores/toasts.svelte.ts';
import { fastImportLinear, openTestPort } from '../helpers/node-port.ts';
import { NaiveLoadMoreStore, mountAutoLoadMore } from '../helpers/effects.svelte.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Hết giờ chờ: ${what}`);
    await sleep(5);
  }
}

async function openFlaky(count: number, commitLimit: number) {
  const test = await openTestPort((git, root) => fastImportLinear(git, root, count));
  cleanups.push(() => test.cleanup());
  const flaky = { failLog: false, logs: [] as string[] };
  const port: RepoPort = {
    ...test.port,
    exec: {
      run: (request: ExecRequest): Promise<ExecResult> => {
        if (request.sub === 'log') {
          flaky.logs.push(request.args.find((arg) => arg.startsWith('--max-count=')) ?? '');
          if (flaky.failLog) return Promise.reject(new Error('giả lập: git log thất bại'));
        }
        return test.port.exec.run(request);
      },
    },
  };
  const prefs = new PrefsStore(null);
  prefs.update({ commitLimit });
  const store = new RepoStore(port, { prefs, toasts: new ToastStore(), detailsDelayMs: 0 });
  cleanups.push(() => store.dispose());
  await store.start();
  await until(() => store.hasLoaded && !store.isLoadingHistory, 'nạp xong');
  return { store, flaky };
}

describe('GraphView: tải thêm tự động khi cuộn gần cuối', () => {
  it('git log hỏng ở lần tải thêm: chỉ thử MỘT lần rồi dừng (không gọi git log mãi)', async () => {
    const { store, flaky } = await openFlaky(450, 200);
    expect(store.entries).toHaveLength(200);
    flaky.failLog = true;
    const before = flaky.logs.length;
    const stop = mountAutoLoadMore(store, () => 200); // the user is sitting at the end of the list
    cleanups.push(stop);
    await sleep(700);

    expect(flaky.logs.length - before).toBe(1);
    expect(store.loadMoreFailed).toBe(true);
    expect(store.commitLimit).toBe(200);
    expect(flaky.logs.every((arg) => Number.isFinite(Number(arg.split('=')[1])))).toBe(true);
  });

  it('store không tự chặn: effect vẫn chỉ yêu cầu MỘT lần cho mỗi độ dài danh sách', async () => {
    const store = new NaiveLoadMoreStore();
    let end = 200;
    const stop = mountAutoLoadMore(store, () => end);
    cleanups.push(stop);
    await sleep(300);
    expect(store.calls).toBe(1);
    // The list grew (a successful load) and the user is still at the end: exactly one more request is allowed.
    end = 400;
    store.entries = Array.from({ length: 400 }, () => undefined as never);
    await sleep(300);
    expect(store.calls).toBe(2);
  });

  it('thành công: tải đúng một lần cho mỗi độ dài danh sách, không tải tiếp khi đã cuộn xa khỏi cuối', async () => {
    const { store, flaky } = await openFlaky(450, 200);
    const before = flaky.logs.length;
    const stop = mountAutoLoadMore(store, () => 200);
    cleanups.push(stop);
    await until(() => store.entries.length === 450, 'tải thêm xong');
    await sleep(100);
    expect(flaky.logs.length - before).toBe(1);
    expect(store.loadMoreFailed).toBe(false);
  });

  it('chưa cuộn tới gần cuối (hoặc chưa có hàng nào thấy) thì không tải', async () => {
    const { store, flaky } = await openFlaky(450, 200);
    const before = flaky.logs.length;
    const stopFar = mountAutoLoadMore(store, () => 100);
    const stopZero = mountAutoLoadMore(store, () => 0);
    cleanups.push(stopFar, stopZero);
    await sleep(150);
    expect(flaky.logs.length - before).toBe(0);
  });
});
