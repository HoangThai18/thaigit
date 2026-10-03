import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecentRepo } from '../src/lib/ipc/types.ts';
import type { Host } from '../src/lib/platform/host.ts';
import { AppStore } from '../src/lib/stores/app.svelte.ts';
import { jsonEqual } from '../src/lib/stores/equality.ts';
import {
  COMMIT_LIMIT_MAX,
  COMMIT_LIMIT_MIN,
  INSPECTOR_LIMITS,
  PREFS_KEY,
  PrefsStore,
  SIDEBAR_LIMITS,
  defaultPrefs,
  sanitizePrefs,
  type KeyValueStorage,
} from '../src/lib/stores/prefs.svelte.ts';
import { ToastStore } from '../src/lib/stores/toasts.svelte.ts';

describe('jsonEqual', () => {
  it('so sánh cấu trúc sâu, phân biệt thứ tự mảng và khoá thừa/thiếu', () => {
    expect(jsonEqual({ a: [1, { b: 'x' }], c: null }, { c: null, a: [1, { b: 'x' }] })).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(jsonEqual({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
    expect(jsonEqual([], {})).toBe(false);
    expect(jsonEqual(null, {})).toBe(false);
    expect(jsonEqual('a', 'a')).toBe(true);
  });
});

describe('sanitizePrefs', () => {
  it('thiếu hoặc rác → mặc định', () => {
    expect(sanitizePrefs(undefined)).toEqual(defaultPrefs());
    expect(sanitizePrefs('x')).toEqual(defaultPrefs());
    expect(sanitizePrefs({ commitLimit: 'nhiều', showTags: 'có', scheme: 'tím', logOrder: 5 })).toEqual(
      defaultPrefs(),
    );
  });

  it('kẹp số vào khoảng hợp lệ, giữ giá trị đúng', () => {
    const prefs = sanitizePrefs({
      commitLimit: 5,
      sidebarWidth: 9999,
      inspectorWidth: 10,
      logOrder: 'topo',
      scheme: 'dark',
      glass: false,
      sidebarSections: { tags: true, local: false },
      columns: { refs: 400, author: 5 },
    });
    expect(prefs.commitLimit).toBe(COMMIT_LIMIT_MIN);
    expect(sanitizePrefs({ commitLimit: 10 ** 9 }).commitLimit).toBe(COMMIT_LIMIT_MAX);
    expect(prefs.sidebarWidth).toBe(SIDEBAR_LIMITS.max);
    expect(prefs.inspectorWidth).toBe(INSPECTOR_LIMITS.min);
    expect(prefs).toMatchObject({ logOrder: 'topo', scheme: 'dark', glass: false });
    expect(prefs.sidebarSections).toEqual({ local: false, remote: true, tags: true, stashes: true });
    expect(prefs.columns).toMatchObject({ refs: 400, author: 60 });
  });
});

describe('PrefsStore', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function memoryStorage(initial?: string): KeyValueStorage & { data: Map<string, string> } {
    const data = new Map<string, string>(initial === undefined ? [] : [[PREFS_KEY, initial]]);
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
    };
  }

  it('đọc từ kho (đã làm sạch), JSON hỏng → mặc định', () => {
    expect(
      new PrefsStore(memoryStorage(JSON.stringify({ commitLimit: 5000, showTags: false }))).value,
    ).toMatchObject({
      commitLimit: 5000,
      showTags: false,
      showRemoteBranches: true,
    });
    expect(new PrefsStore(memoryStorage('{hỏng')).value).toEqual(defaultPrefs());
    expect(new PrefsStore(null).value).toEqual(defaultPrefs());
  });

  it('update kẹp giá trị và ghi xuống kho sau một nhịp (không ghi mỗi lần kéo)', () => {
    const storage = memoryStorage();
    const store = new PrefsStore(storage);
    for (const width of [300, 320, 340, 9999]) store.update({ sidebarWidth: width });
    expect(store.value.sidebarWidth).toBe(SIDEBAR_LIMITS.max);
    expect(storage.data.has(PREFS_KEY)).toBe(false);
    vi.advanceTimersByTime(250);
    expect(JSON.parse(storage.data.get(PREFS_KEY) ?? '{}')).toMatchObject({
      sidebarWidth: SIDEBAR_LIMITS.max,
    });
  });

  it('update lồng: đổi một mục của sidebarSections / columns không mất mục khác', () => {
    const store = new PrefsStore(null);
    store.update({ sidebarSections: { ...store.value.sidebarSections, tags: true } });
    store.update({ columns: { ...store.value.columns, author: 200 } });
    expect(store.value.sidebarSections).toEqual({ local: true, remote: true, tags: true, stashes: true });
    expect(store.value.columns).toMatchObject({ author: 200, refs: 190 });
  });

  it('kho ném lỗi (đầy/bị chặn) không làm hỏng ứng dụng', () => {
    const store = new PrefsStore({
      getItem: () => {
        throw new Error('chặn');
      },
      setItem: () => {
        throw new Error('đầy');
      },
    });
    expect(store.value).toEqual(defaultPrefs());
    expect(() => store.flush()).not.toThrow();
  });
});

describe('AppStore', () => {
  const repo = (id: string, lastOpened: number): RecentRepo => ({
    id,
    name: id,
    path: `/r/${id}`,
    lastOpened,
  });

  function fakeHost(overrides: Partial<Host> = {}): Host {
    return {
      kind: 'tauri',
      pickAndOpenRepo: async () => null,
      openRecent: async () => {
        throw new Error('không dùng');
      },
      listRecentRepos: async () => [repo('cũ', 1), repo('mới', 3), repo('giữa', 2)],
      pickFolder: async () => null,
      cloneRepo: async () => {
        throw new Error('không dùng');
      },
      initRepo: async () => {
        throw new Error('không dùng');
      },
      forgetRecentRepo: async () => {},
      openLaunchRepo: async () => null,
      ...overrides,
    };
  }

  it('nạp danh sách gần đây, mới nhất lên đầu', async () => {
    const app = new AppStore(new ToastStore());
    await app.init(fakeHost());
    expect(app.recent.map((item) => item.id)).toEqual(['mới', 'giữa', 'cũ']);
    expect(app.recentLoaded).toBe(true);
  });

  it('lỗi nạp danh sách → toast lỗi (một cái, thay thế khi lặp), vẫn đánh dấu đã nạp', async () => {
    const toasts = new ToastStore();
    const app = new AppStore(toasts);
    await app.init(
      fakeHost({ listRecentRepos: async () => Promise.reject(new Error('lõi Rust chưa sẵn sàng')) }),
    );
    await app.refreshRecent();
    expect(toasts.items).toHaveLength(1);
    expect(toasts.items[0]).toMatchObject({
      style: 'error',
      message: 'Đã xảy ra lỗi không mong muốn. Hãy thử lại; nếu vẫn lỗi, khởi động lại Thaigit.',
    });
    expect(app.recentLoaded).toBe(true);
    expect(app.recent).toEqual([]);
  });

  it('quên một repo: gọi host rồi bỏ khỏi danh sách; host lỗi thì giữ nguyên và báo lỗi', async () => {
    const toasts = new ToastStore();
    const forgotten: string[] = [];
    const app = new AppStore(toasts);
    await app.init(fakeHost({ forgetRecentRepo: async (id) => void forgotten.push(id) }));
    await app.forgetRecent('giữa');
    expect(forgotten).toEqual(['giữa']);
    expect(app.recent.map((item) => item.id)).toEqual(['mới', 'cũ']);

    const failing = new AppStore(toasts);
    await failing.init(fakeHost({ forgetRecentRepo: async () => Promise.reject(new Error('lỗi')) }));
    await failing.forgetRecent('mới');
    expect(failing.recent.map((item) => item.id)).toEqual(['mới', 'giữa', 'cũ']);
    expect(toasts.items.some((toast) => toast.style === 'error')).toBe(true);
  });
});
