// Thống kê ẩn danh — MẶC ĐỊNH TẮT, chỉ chạy khi người dùng bật (thẻ hỏi ở màn hình chính hoặc Cài đặt). Mỗi ngày tối đa
// một lần gửi đúng 4 trường: mã ngẫu nhiên `telemetryId` (riêng, không liên quan mã cài đặt AI), hệ điều hành, kiến trúc,
// phiên bản app. Tắt → xoá mã. Không gửi tên repo, đường dẫn, email hay nội dung gì khác.

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
  /** Đã hỏi ở màn hình chính chưa (chỉ hỏi một lần). */
  asked: boolean;
  telemetryId: string | null;
  /** Ngày (UTC) đã gửi gần nhất. */
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

/** Nền tảng / kiến trúc của bản build (Tauri CLI đặt `TAURI_ENV_*` lúc build); không xác định → không gửi. */
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

  /** Bản build có gửi được không (biết nền tảng + kiến trúc + phiên bản). */
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

  /** Bỏ qua thẻ hỏi mà không bật. */
  dismiss(): void {
    this.saved.asked = true;
    this.#save();
  }

  /** Gửi nếu đã bật và hôm nay chưa gửi (hai lần gọi chồng nhau chỉ gửi một). Lỗi mạng: im lặng, lần kiểm sau thử lại. */
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
      // Không gửi được: thử lại ở lần kiểm sau.
    }
  }

  /** Kiểm ngay rồi mỗi 6 giờ (app để mở qua đêm vẫn được tính ngày mới). */
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
      // Bị chặn: chỉ sống trong phiên này.
    }
  }
}

export const telemetry = new TelemetryStore();
