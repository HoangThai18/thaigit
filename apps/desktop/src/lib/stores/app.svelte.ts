/**
 * App-wide state outside any single repo: the host (Tauri / the dev bridge) and the recent-repo list.
 * Rust stores the recent list (`list_recent_repos`) — the webview keeps no copy of its own.
 */
import type { RecentRepo } from '../ipc/types.ts';
import type { Host } from '../platform/host.ts';
import { vi } from '../strings.vi.ts';
import { toasts, type ToastStore } from './toasts.svelte.ts';

export class AppStore {
  host = $state.raw<Host | null>(null);
  /** Newest first. */
  recent = $state.raw<readonly RecentRepo[]>([]);
  recentLoaded = $state(false);
  /** Open a new tab in this window (App.svelte wires it up; the Add menu / command palette call it). */
  newTab: (() => void) | null = null;

  constructor(private readonly notify: ToastStore = toasts) {}

  /** `available: false` = no Rust core to ask (running outside Tauri): skip loading the list instead of reporting the same error repeatedly. */
  async init(host: Host, available = true): Promise<void> {
    this.host = host;
    if (available) await this.refreshRecent();
    else this.recentLoaded = true;
  }

  async refreshRecent(): Promise<void> {
    const host = this.host;
    if (!host) return;
    try {
      const list = await host.listRecentRepos();
      this.recent = [...list].sort((a, b) => b.lastOpened - a.lastOpened);
      this.notify.dismissTag('recent');
    } catch (error) {
      this.notify.error(vi.welcome.loadRecentFailed, error, { tag: 'recent' });
    } finally {
      this.recentLoaded = true;
    }
  }

  async forgetRecent(id: string): Promise<void> {
    const host = this.host;
    if (!host) return;
    try {
      await host.forgetRecentRepo(id);
      this.recent = this.recent.filter((repo) => repo.id !== id);
    } catch (error) {
      this.notify.error(vi.welcome.loadRecentFailed, error, { tag: 'recent' });
    }
  }
}

export const app = new AppStore();
