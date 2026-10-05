// Anonymous telemetry: off by default (no request at all), enabling it creates an id, at most once a day, and only the 4 declared fields are sent.
import { describe, expect, it } from 'vitest';
import { buildTarget, TELEMETRY_STORAGE_KEY, TelemetryStore } from '../src/lib/stores/telemetry.svelte.ts';
import type { KeyValueStorage } from '../src/lib/stores/prefs.svelte.ts';

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

function setup(options: { ok?: boolean; now?: () => number } = {}) {
  const calls: { url: string; body: unknown }[] = [];
  const storage = memoryStorage();
  const store = new TelemetryStore({
    storage,
    baseUrl: 'https://may-chu.test',
    appVersion: '2.0.0-beta.2',
    target: { platform: 'windows', arch: 'x86_64' },
    randomId: () => '0f8fad5b-d9cb-469f-a165-70867728950e',
    now: options.now ?? (() => Date.parse('2026-10-03T08:00:00Z')),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: options.ok === false ? 503 : 204 });
    }) as typeof fetch,
  });
  return { store, storage, calls };
}

describe('TelemetryStore', () => {
  it('mặc định tắt: không gửi, không có mã', async () => {
    const { store, calls } = setup();
    await store.pingIfDue();
    expect(store.saved).toMatchObject({ enabled: false, telemetryId: null, asked: false });
    expect(calls).toEqual([]);
  });

  it('bật → gửi đúng 4 trường, mỗi ngày một lần; tắt → xoá mã', async () => {
    let now = Date.parse('2026-10-03T08:00:00Z');
    const { store, storage, calls } = setup({ now: () => now });
    store.setEnabled(true);
    await store.pingIfDue();
    await store.pingIfDue();
    expect(calls).toEqual([
      {
        url: 'https://may-chu.test/v1/telemetry/ping',
        body: {
          telemetryId: '0f8fad5b-d9cb-469f-a165-70867728950e',
          platform: 'windows',
          arch: 'x86_64',
          appVersion: '2.0.0-beta.2',
        },
      },
    ]);
    now += 24 * 60 * 60 * 1000;
    await store.pingIfDue();
    expect(calls).toHaveLength(2);
    store.setEnabled(false);
    expect(JSON.parse(storage.data.get(TELEMETRY_STORAGE_KEY) ?? '{}')).toMatchObject({
      enabled: false,
      telemetryId: null,
    });
    await store.pingIfDue();
    expect(calls).toHaveLength(2);
  });

  it('máy chủ lỗi → chưa đánh dấu đã gửi, lần sau thử lại', async () => {
    const { store, calls } = setup({ ok: false });
    store.setEnabled(true);
    await store.pingIfDue();
    await store.pingIfDue();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(store.saved.lastPingDay).toBe('');
  });

  it('bỏ qua thẻ hỏi: không bật, không hỏi lại', () => {
    const { store, calls } = setup();
    store.dismiss();
    expect(store.saved).toMatchObject({ asked: true, enabled: false });
    expect(calls).toEqual([]);
  });

  it('nền tảng / kiến trúc của bản build', () => {
    expect(buildTarget({ TAURI_ENV_PLATFORM: 'windows', TAURI_ENV_ARCH: 'x86_64' })).toEqual({
      platform: 'windows',
      arch: 'x86_64',
    });
    expect(buildTarget({ TAURI_ENV_PLATFORM: 'darwin', TAURI_ENV_ARCH: 'aarch64' })).toEqual({
      platform: 'macos',
      arch: 'aarch64',
    });
    expect(buildTarget({ TAURI_ENV_PLATFORM: 'linux', TAURI_ENV_ARCH: 'x86_64' })).toBeNull();
    expect(buildTarget({})).toBeNull();
  });
});
