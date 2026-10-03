// Kho cập nhật tự động với "Rust" giả: báo bản mới một lần mỗi phiên bản, hỏi trước khi cài, tiến độ, lỗi + thử lại.
import { describe, expect, it } from 'vitest';
import type { UpdateInfo, UpdateProgressEvent } from '@thaigit/contracts';
import { DialogStore } from '../src/lib/stores/dialogs.svelte.ts';
import { ToastStore } from '../src/lib/stores/toasts.svelte.ts';
import { UpdateStore, type UpdatePort } from '../src/lib/stores/update.svelte.ts';

const NEXT: UpdateInfo = {
  currentVersion: '2.0.0-beta.1',
  version: '2.0.0-beta.2',
  notes: 'Sửa lỗi push',
  pubDate: null,
};

function fakePort(result: UpdateInfo | null = NEXT) {
  let available: ((update: UpdateInfo) => void) | null = null;
  let progress: ((event: UpdateProgressEvent) => void) | null = null;
  const calls = { install: 0, check: 0 };
  let failInstall: Error | null = null;
  const port: UpdatePort = {
    async check() {
      calls.check++;
      return result;
    },
    async install() {
      calls.install++;
      if (failInstall) throw failInstall;
      progress?.({ phase: 'downloading', downloaded: 512, total: 1024, message: null });
    },
    async onAvailable(handler) {
      available = handler;
      return () => (available = null);
    },
    async onProgress(handler) {
      progress = handler;
      return () => (progress = null);
    },
  };
  return {
    port,
    calls,
    announce: (update: UpdateInfo) => available?.(update),
    progress: (event: UpdateProgressEvent) => progress?.(event),
    failNextInstall: (error: Error) => (failInstall = error),
  };
}

function setup(result?: UpdateInfo | null) {
  const toasts = new ToastStore();
  const dialogs = new DialogStore();
  const store = new UpdateStore({ toasts, dialogs });
  const fake = fakePort(result);
  return { toasts, dialogs, store, fake };
}

describe('UpdateStore', () => {
  it('báo bản mới bằng một toast (không lặp lại cùng phiên bản), cài sau khi xác nhận', async () => {
    const { toasts, dialogs, store, fake } = setup();
    await store.start(fake.port);
    fake.announce(NEXT);
    fake.announce(NEXT);
    expect(toasts.items.map((toast) => toast.title)).toEqual(['Có Thaigit 2.0.0-beta.2']);
    expect(toasts.items[0]?.actions.map((action) => action.title)).toEqual(['Cập nhật ngay', 'Có gì mới']);
    expect(store.available).toEqual(NEXT);

    const installing = store.install();
    expect(dialogs.current?.title).toBe('Cập nhật lên Thaigit 2.0.0-beta.2?');
    expect(dialogs.current?.message).toContain('Sửa lỗi push');
    dialogs.answer('confirm');
    await installing;
    expect(fake.calls.install).toBe(1);
    expect(store.progress).toEqual({ phase: 'downloading', downloaded: 512, total: 1024, message: null });
    expect(store.installing).toBe(true);
    // Đang cài thì bấm lại không cài lần hai.
    await store.install(false);
    expect(fake.calls.install).toBe(1);
  });

  it('huỷ hộp xác nhận thì không cài', async () => {
    const { dialogs, store, fake } = setup();
    await store.start(fake.port);
    fake.announce(NEXT);
    const installing = store.install();
    dialogs.answer('cancel');
    await installing;
    expect(fake.calls.install).toBe(0);
    expect(store.progress).toBeNull();
  });

  it('lỗi khi cài: toast lỗi có "Thử lại", đóng được thanh tiến độ', async () => {
    const { toasts, store, fake } = setup();
    await store.start(fake.port);
    fake.announce(NEXT);
    fake.progress({ phase: 'failed', downloaded: 0, total: null, message: 'chữ ký không hợp lệ' });
    const failed = toasts.items.at(-1);
    expect(failed?.title).toBe('Cập nhật không thành công');
    expect(failed?.actions.map((action) => action.title)).toEqual(['Thử lại']);
    expect(store.installing).toBe(false);
    store.dismissProgress();
    expect(store.progress).toBeNull();

    fake.failNextInstall(new Error('Đang chạy lệnh git'));
    await store.install(false);
    expect(store.progress?.phase).toBe('failed');
    expect(toasts.items.at(-1)?.title).toBe('Cập nhật không thành công');
  });

  it('kiểm tra thủ công: báo đã mới nhất', async () => {
    const { toasts, store, fake } = setup(null);
    await store.start(fake.port);
    await store.check('2.0.0-beta.1');
    expect(fake.calls.check).toBe(1);
    expect(toasts.items.at(-1)?.title).toBe('Bạn đang dùng bản mới nhất (2.0.0-beta.1)');
    expect(store.available).toBeNull();
  });

  it('kiểm tra thủ công thấy bản đã báo trước đó: vẫn hiện lại toast', async () => {
    const { toasts, store, fake } = setup();
    await store.start(fake.port);
    fake.announce(NEXT);
    await store.check('2.0.0-beta.1');
    expect(toasts.items.at(-1)?.title).toBe('Có Thaigit 2.0.0-beta.2');
  });
});
