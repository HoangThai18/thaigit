import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_TOASTS, ToastStore, describeError, toastLifetimeMs } from '../src/lib/stores/toasts.svelte.ts';

describe('toastLifetimeMs', () => {
  it('lỗi/cảnh báo không tự ẩn; còn lại 4s, có nút hành động thì 9s', () => {
    expect(toastLifetimeMs({ style: 'error', actions: [] })).toBeNull();
    expect(toastLifetimeMs({ style: 'warning', actions: [] })).toBeNull();
    expect(toastLifetimeMs({ style: 'info', actions: [] })).toBe(4000);
    expect(toastLifetimeMs({ style: 'success', actions: [{ title: 'x', run: () => {} }] })).toBe(9000);
  });
});

describe('describeError', () => {
  it('không bao giờ trả message gốc của lỗi: chỉ câu thân thiện', () => {
    expect(describeError(new Error('  boom\n'))).toBe(
      'Đã xảy ra lỗi không mong muốn. Hãy thử lại; nếu vẫn lỗi, khởi động lại Thaigit.',
    );
    expect(describeError('chuỗi')).toBe(
      'Đã xảy ra lỗi không mong muốn. Hãy thử lại; nếu vẫn lỗi, khởi động lại Thaigit.',
    );
    expect(describeError(new TypeError("Cannot read properties of undefined (reading 'x')"))).not.toContain(
      'Cannot',
    );
  });
});

describe('ToastStore', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('thông báo thường tự ẩn đúng hạn, lỗi thì ở lại', () => {
    const store = new ToastStore();
    store.info('thông tin');
    const errorId = store.error('hỏng', new Error('chi tiết'));
    expect(store.items).toHaveLength(2);
    vi.advanceTimersByTime(3999);
    expect(store.items).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(store.items.map((item) => item.id)).toEqual([errorId]);
    vi.advanceTimersByTime(60_000);
    expect(store.items).toHaveLength(1);
    expect(store.items[0]).toMatchObject({
      style: 'error',
      title: 'hỏng',
      message: 'Đã xảy ra lỗi không mong muốn. Hãy thử lại; nếu vẫn lỗi, khởi động lại Thaigit.',
    });
  });

  it('giữ tối đa 4 cái (bỏ cái cũ nhất)', () => {
    const store = new ToastStore();
    for (let index = 0; index < MAX_TOASTS + 2; index++) store.warning(`w${index}`);
    expect(store.items.map((item) => item.title)).toEqual(['w2', 'w3', 'w4', 'w5']);
  });

  it('push cùng tag thay cái cũ; dismissTag gỡ cả nhóm', () => {
    const store = new ToastStore();
    store.error('lần 1', undefined, { tag: 'refresh' });
    store.error('lần 2', undefined, { tag: 'refresh' });
    store.warning('khác');
    expect(store.items.map((item) => item.title)).toEqual(['lần 2', 'khác']);
    expect(store.hasTag('refresh')).toBe(true);
    store.dismissTag('refresh');
    expect(store.items.map((item) => item.title)).toEqual(['khác']);
    expect(store.hasTag('refresh')).toBe(false);
  });

  it('đóng tay xoá bộ hẹn giờ (không còn timer treo)', () => {
    const store = new ToastStore();
    const id = store.info('x');
    store.dismiss(id);
    expect(store.items).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('nút hành động được giữ nguyên để giao diện gọi', () => {
    const store = new ToastStore();
    const run = vi.fn();
    store.info('có nút', { actions: [{ title: 'Tải thêm', run }] });
    store.items[0]?.actions[0]?.run();
    expect(run).toHaveBeenCalledOnce();
  });
});
