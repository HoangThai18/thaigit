/**
 * Trạng thái dùng chung toàn app (ngoài một repo cụ thể): host (Tauri / cầu nối dev) và danh sách repo gần đây.
 * Danh sách gần đây do Rust lưu (`list_recent_repos`) — webview không giữ bản của riêng mình.
 */
import type { RecentRepo } from '../ipc/types.ts';
import type { Host } from '../platform/host.ts';
import { vi } from '../strings.vi.ts';
import { toasts, type ToastStore } from './toasts.svelte.ts';

export class AppStore {
  host = $state.raw<Host | null>(null);
  /** Mới → cũ. */
  recent = $state.raw<readonly RecentRepo[]>([]);
  recentLoaded = $state(false);
  /** Mở tab mới trong cửa sổ này (App.svelte gắn vào; menu Thêm / command palette gọi). */
  newTab: (() => void) | null = null;

  constructor(private readonly notify: ToastStore = toasts) {}

  /** `available: false` = không có lõi Rust để hỏi (chạy ngoài Tauri): bỏ qua việc nạp danh sách, khỏi báo lỗi lặp. */
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
