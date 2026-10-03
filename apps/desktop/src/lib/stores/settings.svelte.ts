// Màn Cài đặt mở / đóng (một màn cho cả app) và kênh cập nhật đã chọn (Rust lưu kênh thật; ở đây chỉ nhớ để hiển thị).

import type { UpdateChannel } from '@thaigit/contracts';
import { browserStorage, type KeyValueStorage } from './prefs.svelte.ts';

export const CHANNEL_KEY = 'thaigit.update-channel.v1';

/** Kênh mặc định giống Rust: bản prerelease (2.0.0-beta.1) → beta, còn lại → stable. */
export function defaultChannel(version: string): UpdateChannel {
  return version.includes('-') ? 'beta' : 'stable';
}

export class SettingsStore {
  isOpen = $state(false);
  channel = $state<UpdateChannel>('stable');
  readonly #storage: KeyValueStorage | null;

  constructor(
    storage: KeyValueStorage | null = browserStorage(),
    version = import.meta.env.VITE_APP_VERSION ?? '',
  ) {
    this.#storage = storage;
    let saved: string | null = null;
    try {
      saved = storage?.getItem(CHANNEL_KEY) ?? null;
    } catch {
      saved = null;
    }
    this.channel = saved === 'beta' || saved === 'stable' ? saved : defaultChannel(version);
  }

  open(): void {
    this.isOpen = true;
  }

  close(): void {
    this.isOpen = false;
  }

  rememberChannel(channel: UpdateChannel): void {
    this.channel = channel;
    try {
      this.#storage?.setItem(CHANNEL_KEY, channel);
    } catch {
      // Bị chặn: chỉ ảnh hưởng hiển thị.
    }
  }
}

export const settingsStore = new SettingsStore();
