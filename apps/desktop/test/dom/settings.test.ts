// Màn Cài đặt dựng bằng Svelte thật: Ctrl/⌘+, mở/đóng, đổi lựa chọn áp ngay vào prefs / thống kê, số ngoài khoảng bị kẹp;
// mục AI ẩn khi AI đang tạm tắt.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SettingsPanel from '../../src/lib/settings/SettingsPanel.svelte';
import { AiStore } from '../../src/lib/stores/ai.svelte.ts';
import { PrefsStore } from '../../src/lib/stores/prefs.svelte.ts';
import { SettingsStore } from '../../src/lib/stores/settings.svelte.ts';
import { TelemetryStore } from '../../src/lib/stores/telemetry.svelte.ts';
import { vi } from '../../src/lib/strings.vi.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function setup() {
  const settings = new SettingsStore(null, '2.0.0-beta.2');
  const prefs = new PrefsStore(null);
  const ai = new AiStore({ storage: null });
  const telemetry = new TelemetryStore({
    storage: null,
    target: { platform: 'windows', arch: 'x86_64' },
    appVersion: '2.0.0-beta.2',
    fetch: (async () => new Response(null, { status: 204 })) as typeof fetch,
  });
  const target = document.createElement('div');
  document.body.append(target);
  const app = mount(SettingsPanel, {
    target,
    props: { settings, prefs, ai, telemetry, setChannel: async () => {} },
  });
  cleanups.push(() => {
    unmount(app);
    target.remove();
  });
  flushSync();
  return { settings, prefs, ai, telemetry, target };
}

function change(element: Element | null, value: string | boolean): void {
  if (element instanceof HTMLInputElement && element.type === 'checkbox') element.checked = value as boolean;
  else (element as HTMLInputElement | HTMLSelectElement).value = String(value);
  element?.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

describe('SettingsPanel', () => {
  it('Ctrl+, mở và đóng; Esc đóng', () => {
    const { settings, target } = setup();
    expect(target.querySelector('[role=dialog]')).toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true }));
    flushSync();
    expect(settings.isOpen).toBe(true);
    expect(target.querySelector('#settings-title')?.textContent).toBe('Cài đặt');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(settings.isOpen).toBe(false);
  });

  it('đổi lựa chọn áp ngay; số ngoài khoảng bị kẹp', () => {
    const { settings, prefs, telemetry, target } = setup();
    settings.open();
    flushSync();
    const selects = [...target.querySelectorAll('select')];
    change(selects[0] ?? null, 'dark');
    expect(prefs.value.scheme).toBe('dark');
    const numbers = [...target.querySelectorAll('input[type=number]')];
    change(numbers[0] ?? null, '5');
    expect(prefs.value.commitLimit).toBe(200);
    // AI đang tạm tắt (AI_ENABLED = false): mục AI không có trong Cài đặt.
    const conventional = [...target.querySelectorAll('label.check')].find((label) =>
      label.textContent?.includes('Conventional'),
    );
    expect(conventional).toBeUndefined();
    expect(target.textContent).not.toContain(vi.settings.ai);
    const stats = [...target.querySelectorAll('label.check')].find((label) =>
      label.textContent?.includes('thống kê'),
    );
    change(stats?.querySelector('input') ?? null, true);
    expect(telemetry.saved.enabled).toBe(true);
    expect(telemetry.saved.telemetryId).not.toBeNull();
  });
});
