// Anonymous analytics — OFF BY DEFAULT, only active once the user enables it (a card on the main screen or in Settings). At most
// once a day exactly 4 fields are sent: a random `telemetryId` (separate, unrelated to the AI install id), the OS, the
// architecture, and the app version. Turning it off deletes the id. No repo names, paths, email addresses or any other content.

import {
  TELEMETRY_PING_PATH,
  type TelemetryArch,
  type TelemetryPing,
  type TelemetryPlatform,
} from '@thaigit/contracts';
import { DEFAULT_API_URL } from '../ai/client.ts';
import { browserStorage, type KeyValueStorage } from './prefs.svelte.ts';

export const TELEMETRY_STORAGE_KEY = 'thaigit.telemetry.v1';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

interface TelemetrySaved {
  enabled: boolean;
  /** Whether the main-screen card has already been answered (asked once only). */
  asked: boolean;
  telemetryId: string | null;
  /** The UTC day of the last successful send. */
  lastPingDay: string;
}

function sanitize(raw: unknown): TelemetrySaved {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<
    Record<keyof TelemetrySaved, unknown>
  >;
  const enabled = value.enabled === true;
  return {
    enabled,
    asked: value.asked === true,
    telemetryId: enabled && typeof value.telemetryId === 'string' ? value.telemetryId : null,
    lastPingDay: typeof value.lastPingDay === 'string' ? value.lastPingDay : '',
  };
}

/** The build's platform / architecture (the Tauri CLI sets `TAURI_ENV_*` at build time); unknown → nothing is sent. */
export function buildTarget(
  env: { TAURI_ENV_PLATFORM?: string; TAURI_ENV_ARCH?: string } = import.meta.env,
): { platform: TelemetryPlatform; arch: TelemetryArch } | null {
  const platform =
    env.TAURI_ENV_PLATFORM === 'windows' ? 'windows' : env.TAURI_ENV_PLATFORM === 'darwin' ? 'macos' : null;
  const arch =
    env.TAURI_ENV_ARCH === 'x86_64' ? 'x86_64' : env.TAURI_ENV_ARCH === 'aarch64' ? 'aarch64' : null;
  return platform !== null && arch !== null ? { platform, arch } : null;
}

export interface TelemetryOptions {
  storage?: KeyValueStorage | null;
  fetch?: typeof fetch;
  baseUrl?: string;
  appVersion?: string;
  target?: ReturnType<typeof buildTarget>;
  randomId?: () => string;
  now?: () => number;
}

export class TelemetryStore {
  saved = $state<TelemetrySaved>(sanitize(null));
  readonly #storage: KeyValueStorage | null;
  readonly #fetch: typeof fetch;
  readonly #baseUrl: string;
  readonly #appVersion: string;
  readonly #target: ReturnType<typeof buildTarget>;
  readonly #randomId: () => string;
  readonly #now: () => number;
  #timer: ReturnType<typeof setInterval> | undefined;
  #inflight: Promise<void> | null = null;

  constructor(options: TelemetryOptions = {}) {
    this.#storage = options.storage === undefined ? browserStorage() : options.storage;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#baseUrl = (options.baseUrl ?? (import.meta.env.VITE_THAIGIT_API_URL || DEFAULT_API_URL)).replace(
      /\/+$/,
      '',
    );
    this.#appVersion = options.appVersion ?? import.meta.env.VITE_APP_VERSION ?? '';
    this.#target = options.target === undefined ? buildTarget() : options.target;
    this.#randomId = options.randomId ?? (() => crypto.randomUUID());
    this.#now = options.now ?? Date.now;
    let raw: unknown;
    try {
      const text = this.#storage?.getItem(TELEMETRY_STORAGE_KEY);
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = null;
    }
    this.saved = sanitize(raw);
  }

  /** Whether this build can send anything (platform + architecture + version known). */
  get supported(): boolean {
    return this.#target !== null && this.#appVersion !== '';
  }

  setEnabled(enabled: boolean): void {
    this.saved.asked = true;
    this.saved.enabled = enabled;
    this.saved.telemetryId = enabled ? (this.saved.telemetryId ?? this.#randomId()) : null;
    if (!enabled) this.saved.lastPingDay = '';
    this.#save();
    if (enabled) void this.pingIfDue();
  }

  /** Dismiss the card without enabling it. */
  dismiss(): void {
    this.saved.asked = true;
    this.#save();
  }

  /** Send if enabled and not already sent today (two overlapping calls send once). A network error is silent; the next check retries. */
  pingIfDue(): Promise<void> {
    this.#inflight ??= this.#ping().finally(() => {
      this.#inflight = null;
    });
    return this.#inflight;
  }

  async #ping(): Promise<void> {
    const { enabled, telemetryId, lastPingDay } = this.saved;
    const target = this.#target;
    if (!enabled || telemetryId === null || target === null || this.#appVersion === '') return;
    const day = new Date(this.#now()).toISOString().slice(0, 10);
    if (lastPingDay === day) return;
    const body: TelemetryPing = { telemetryId, ...target, appVersion: this.#appVersion };
    try {
      const response = await this.#fetch(`${this.#baseUrl}${TELEMETRY_PING_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.ok && this.saved.enabled) {
        this.saved.lastPingDay = day;
        this.#save();
      }
    } catch {
      // Nothing sent: retry at the next check.
    }
  }

  /** Check right away, then every 6 hours (an app left open overnight still counts the new day). */
  start(): void {
    this.stop();
    void this.pingIfDue();
    this.#timer = setInterval(() => void this.pingIfDue(), CHECK_EVERY_MS);
  }

  stop(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  #save(): void {
    try {
      this.#storage?.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify($state.snapshot(this.saved)));
    } catch {
      // Blocked: it only lives for this session.
    }
  }
}

export const telemetry = new TelemetryStore();
