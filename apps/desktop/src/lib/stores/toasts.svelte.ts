/**
 * Thông báo nổi (toast), port `Toast`/`RepoModel.toast` của app Swift: tối đa 4 cái, lỗi/cảnh báo ở lại tới khi đóng,
 * còn lại tự ẩn sau 4 giây (9 giây nếu có nút hành động). Một kho dùng chung cho cả màn hình chính lẫn cửa sổ repo.
 */

export type ToastStyle = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  readonly title: string;
  readonly run: () => void;
}

export interface Toast {
  readonly id: number;
  readonly style: ToastStyle;
  readonly title: string;
  readonly message: string | null;
  readonly actions: readonly ToastAction[];
  /** Nhóm để gỡ cùng lúc khi không còn đúng; push cùng `tag` sẽ thay cái cũ (khỏi chồng lỗi lặp). */
  readonly tag: string | null;
}

export interface ToastOptions {
  message?: string | null;
  actions?: readonly ToastAction[];
  tag?: string;
}

export const MAX_TOASTS = 4;

/** `null` = không tự ẩn. */
export function toastLifetimeMs(toast: Pick<Toast, 'style' | 'actions'>): number | null {
  if (toast.style === 'error' || toast.style === 'warning') return null;
  return toast.actions.length === 0 ? 4000 : 9000;
}

/** Nội dung lỗi để hiện: `message` của Error (GitError đã gồm stderr), không thì chuỗi hoá. */
export function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.trim();
}

export class ToastStore {
  items = $state.raw<readonly Toast[]>([]);
  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  push(style: ToastStyle, title: string, options: ToastOptions = {}): number {
    const toast: Toast = {
      id: this.nextId++,
      style,
      title,
      message: options.message ?? null,
      actions: options.actions ?? [],
      tag: options.tag ?? null,
    };
    let next = toast.tag === null ? [...this.items] : this.items.filter((item) => item.tag !== toast.tag);
    next.push(toast);
    if (next.length > MAX_TOASTS) next = next.slice(next.length - MAX_TOASTS);
    this.replace(next);
    const lifetime = toastLifetimeMs(toast);
    if (lifetime !== null)
      this.timers.set(
        toast.id,
        setTimeout(() => this.dismiss(toast.id), lifetime),
      );
    return toast.id;
  }

  info(title: string, options?: ToastOptions): number {
    return this.push('info', title, options);
  }

  success(title: string, options?: ToastOptions): number {
    return this.push('success', title, options);
  }

  warning(title: string, options?: ToastOptions): number {
    return this.push('warning', title, options);
  }

  error(title: string, error?: unknown, options: ToastOptions = {}): number {
    const message = error === undefined ? options.message : describeError(error);
    return this.push('error', title, { ...options, message });
  }

  dismiss(id: number): void {
    this.replace(this.items.filter((item) => item.id !== id));
  }

  dismissTag(tag: string): void {
    this.replace(this.items.filter((item) => item.tag !== tag));
  }

  clear(): void {
    this.replace([]);
  }

  hasTag(tag: string): boolean {
    return this.items.some((item) => item.tag === tag);
  }

  /** Cập nhật danh sách và dọn bộ hẹn giờ của các toast không còn. */
  private replace(next: readonly Toast[]): void {
    const alive = new Set(next.map((item) => item.id));
    for (const [id, timer] of this.timers) {
      if (!alive.has(id)) {
        clearTimeout(timer);
        this.timers.delete(id);
      }
    }
    this.items = next;
  }
}

export const toasts = new ToastStore();
