// The auto-update state for the UI: a new version Rust just reported (`update-available`), the install progress (`update-progress`),
// and the two things the user can do — check now, install. Only active in the Tauri app (a dev bridge / tests stay quiet).

import type { UpdateInfo, UpdateProgressEvent } from '@thaigit/contracts';
import { friendlyError } from '../errors/friendly.ts';
import { vi } from '../strings.vi.ts';
import { dialogs as globalDialogs, type DialogStore } from './dialogs.svelte.ts';
import { toasts as globalToasts, type ToastAction, type ToastStore } from './toasts.svelte.ts';

/** The functions talking to Rust (factored out so tests need no Tauri). */
export interface UpdatePort {
  check(): Promise<UpdateInfo | null>;
  install(): Promise<void>;
  onAvailable(handler: (update: UpdateInfo) => void): Promise<() => void>;
  onProgress(handler: (event: UpdateProgressEvent) => void): Promise<() => void>;
}

const TOAST_TAG = 'update';

export class UpdateStore {
  available = $state.raw<UpdateInfo | null>(null);
  progress = $state.raw<UpdateProgressEvent | null>(null);
  checking = $state(false);

  private port: UpdatePort | null = null;
  private readonly toasts: ToastStore;
  private readonly dialogs: DialogStore;
  private stops: (() => void)[] = [];
  /** The version already announced by a toast (so it is not announced again every 6 hours). */
  private announced: string | null = null;

  constructor(options: { toasts?: ToastStore; dialogs?: DialogStore } = {}) {
    this.toasts = options.toasts ?? globalToasts;
    this.dialogs = options.dialogs ?? globalDialogs;
  }

  get installing(): boolean {
    const phase = this.progress?.phase;
    return phase === 'downloading' || phase === 'verifying' || phase === 'installing' || phase === 'ready';
  }

  async start(port: UpdatePort): Promise<void> {
    this.port = port;
    this.stops.push(await port.onAvailable((update) => this.didFind(update, false)));
    this.stops.push(
      await port.onProgress((event) => {
        // Rust's error reason is technical text: keep only the friendly sentence.
        this.progress = event.phase === 'failed' ? { ...event, message: vi.update.failedHint } : event;
        if (event.phase === 'failed') {
          this.toasts.error(vi.update.failed, undefined, {
            message: vi.update.failedHint,
            tag: TOAST_TAG,
            actions: this.available ? [{ title: vi.update.retry, run: () => void this.install(false) }] : [],
          });
        }
      }),
    );
  }

  stop(): void {
    for (const stop of this.stops.splice(0)) stop();
    this.port = null;
  }

  /** Check right away (the user pressed "Check for updates…"): reports even when already current or on error. */
  async check(currentVersion: string): Promise<void> {
    const port = this.port;
    if (!port || this.checking) return;
    this.checking = true;
    this.toasts.info(vi.update.checking, { tag: TOAST_TAG });
    try {
      const update = await port.check();
      if (update) this.didFind(update, true);
      else {
        this.available = null;
        this.toasts.success(vi.update.upToDate(currentVersion), { tag: TOAST_TAG });
      }
    } catch (error) {
      this.toasts.error(vi.update.checkFailed, error, { tag: TOAST_TAG });
    } finally {
      this.checking = false;
    }
  }

  /** Install the reported version (asks first unless `confirm = false`, e.g. a "Retry" click). */
  async install(confirm = true): Promise<void> {
    const port = this.port;
    const update = this.available;
    if (!port || !update || this.installing) return;
    if (confirm) {
      const ok = await this.dialogs.confirm({
        title: vi.update.installConfirmTitle(update.version),
        message: update.notes
          ? `${vi.update.installConfirmMessage}\n\n${update.notes}`
          : vi.update.installConfirmMessage,
        confirmTitle: vi.update.installConfirm,
      });
      if (!ok) return;
    }
    this.progress = { phase: 'downloading', downloaded: 0, total: null, message: null };
    try {
      await port.install();
    } catch (error) {
      // Rust already emitted `failed` (toast shown above); an error before the download starts (no version, busy) is reported here.
      if (this.progress?.phase !== 'failed') {
        this.progress = { phase: 'failed', downloaded: 0, total: null, message: friendlyError(error) };
        this.toasts.error(vi.update.failed, error, { tag: TOAST_TAG });
      }
    }
  }

  dismissProgress(): void {
    if (!this.installing) this.progress = null;
  }

  private didFind(update: UpdateInfo, manual: boolean): void {
    this.available = update;
    if (!manual && this.announced === update.version) return;
    this.announced = update.version;
    const actions: ToastAction[] = [{ title: vi.update.installNow, run: () => void this.install() }];
    if (update.notes) {
      const notes = update.notes;
      actions.push({
        title: vi.update.notes,
        run: () =>
          void this.dialogs
            .confirm({
              title: vi.update.notesTitle(update.version),
              message: notes,
              confirmTitle: vi.update.installNow,
            })
            .then((ok) => {
              if (ok) void this.install(false);
            }),
      });
    }
    this.toasts.info(vi.update.available(update.version), {
      message: vi.update.availableMessage(update.currentVersion),
      tag: TOAST_TAG,
      actions,
    });
  }
}

export const updates = new UpdateStore();
