/**
 * Toast notifications, a port of the Swift app's `Toast`/`RepoModel.toast`: at most 4, errors and warnings stay until dismissed,
 * the rest auto-hide after 4 seconds (9 when they carry an action button). One store shared by both the main screen and repo windows.
 */

import { friendlyError } from '../errors/friendly.ts';

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
  /** A group to remove together when it is no longer accurate; pushing the same `tag` replaces the old one (no duplicate error toasts). */
  readonly tag: string | null;
  /**
   * An owner (e.g. an open repo): a toast's action button calls into that object, so when it disappears the toast must go too
   * (`dismissOwner`) — never leave a clickable notification acting on something that no longer exists.
   */
  readonly owner: string | null;
}

export interface ToastOptions {
  message?: string | null;
  actions?: readonly ToastAction[];
  tag?: string;
  owner?: string;
}

export const MAX_TOASTS = 4;

/** `null` = never auto-hide. */
export function toastLifetimeMs(toast: Pick<Toast, 'style' | 'actions'>): number | null {
  if (toast.style === 'error' || toast.style === 'warning') return null;
  return toast.actions.length === 0 ? 4000 : 9000;
}

/**
 * The error content to display: ALWAYS a friendly sentence (errors/friendly.ts) — never stderr / a raw message / a stack trace.
 * The original error only goes to the console in dev builds.
 */
export function describeError(error: unknown): string {
  if (import.meta.env?.DEV) console.warn('[Thaigit]', error);
  return friendlyError(error);
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
      owner: options.owner ?? null,
    };
    // The same tag, or exactly the same notification already on screen (e.g. clicking checkout twice in a row): replace it instead of stacking.
    let next = this.items.filter(
      (item) =>
        !(toast.tag !== null && item.tag === toast.tag) &&
        !(
          item.style === toast.style &&
          item.title === toast.title &&
          item.message === toast.message &&
          item.owner === toast.owner
        ),
    );
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

  /** An error toast: `error` (if any) is turned into a friendly sentence — a raw error is never shown. */
  error(title: string, error?: unknown, options: ToastOptions = {}): number {
    const friendly = error === undefined ? options.message : describeError(error);
    // The title already says exactly that, so do not repeat it in the description.
    const message = friendly === title ? null : friendly;
    return this.push('error', title, { ...options, message });
  }

  dismiss(id: number): void {
    this.replace(this.items.filter((item) => item.id !== id));
  }

  dismissTag(tag: string): void {
    this.replace(this.items.filter((item) => item.tag !== tag));
  }

  /** Remove every toast of one owner (e.g. when closing a repo). */
  dismissOwner(owner: string): void {
    this.replace(this.items.filter((item) => item.owner !== owner));
  }

  clear(): void {
    this.replace([]);
  }

  hasTag(tag: string): boolean {
    return this.items.some((item) => item.tag === tag);
  }

  /** Update the list and clear the timers of toasts that are gone. */
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
