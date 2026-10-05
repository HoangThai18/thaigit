// Whether the Settings screen is open / closed (one screen for the whole app) and the selected update channel (Rust stores the real channel; this only remembers it for display).

import type { UpdateChannel } from '@thaigit/contracts';
import { browserStorage, type KeyValueStorage } from './prefs.svelte.ts';

export const CHANNEL_KEY = 'thaigit.update-channel.v1';

/** The default channel matches Rust: a prerelease build (2.0.0-beta.1) → beta, otherwise stable. */
export function defaultChannel(version: string): UpdateChannel {
  return version.includes('-') ? 'beta' : 'stable';
}

export class SettingsStore {
  isOpen = $state(false);
  /** The section to scroll to when opening (e.g. "Accounts" from the homepage); the panel is removed after scrolling. */
  focus = $state<'accounts' | null>(null);
  channel = $state<UpdateChannel>('stable');
  readonly #storage: KeyValueStorage | null;

  constructor(
    storage: KeyValueStorage | null = browserStorage(),
    version = import.meta.env.VITE_APP_VERSION ?? '',
  ) {
    this.#storage = storage;
    let saved: string | null;
    try {
      saved = storage?.getItem(CHANNEL_KEY) ?? null;
    } catch {
      saved = null;
    }
    this.channel = saved === 'beta' || saved === 'stable' ? saved : defaultChannel(version);
  }

  open(focus: 'accounts' | null = null): void {
    this.focus = focus;
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
      // Blocked: display is the only thing affected.
    }
  }
}

export const settingsStore = new SettingsStore();
