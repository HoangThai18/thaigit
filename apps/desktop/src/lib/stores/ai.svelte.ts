// The app's AI state: consent, the AI install id (`aiInstallId` — created only AFTER consent, kept strictly apart from the
// analytics id), the token, commit-writing options, and today's remaining quota. Without consent no request reaches /v1/ai/*
// and no install id exists.
// Kept in the webview's localStorage (the token is only used to attach the quota; it grants nothing).

import {
  AI_LANGUAGES,
  AI_LENGTHS,
  type AiCommitOptions,
  type AiFeature,
  type AiFrame,
  type AiRequestByFeature,
  type AiSkippedFile,
  type AiDiffFile,
  type QuotaResponse,
} from '@thaigit/contracts';
import { AiClient, AiFailure, DEFAULT_API_URL, type AiIdentity } from '../ai/client.ts';
import { browserStorage, type KeyValueStorage } from './prefs.svelte.ts';

export const AI_STORAGE_KEY = 'thaigit.ai.v1';
/** A token the server rejected triggers one re-registration, at most this many times per day (avoids a loop while the server is failing). */
const MAX_REGISTRATIONS_PER_DAY = 3;

interface AiSaved {
  consented: boolean;
  installId: string | null;
  token: string | null;
  options: AiCommitOptions;
  registrations: { day: string; count: number };
}

function defaults(): AiSaved {
  return {
    consented: false,
    installId: null,
    token: null,
    options: { language: 'auto', conventional: false, length: 'normal' },
    registrations: { day: '', count: 0 },
  };
}

function sanitize(raw: unknown): AiSaved {
  const base = defaults();
  if (typeof raw !== 'object' || raw === null) return base;
  const value = raw as Partial<Record<keyof AiSaved, unknown>>;
  const options = (
    typeof value.options === 'object' && value.options !== null ? value.options : {}
  ) as Record<string, unknown>;
  const registrations = (
    typeof value.registrations === 'object' && value.registrations !== null ? value.registrations : {}
  ) as Record<string, unknown>;
  const consented = value.consented === true;
  return {
    consented,
    // Without consent, keep no install id at all.
    installId: consented && typeof value.installId === 'string' ? value.installId : null,
    token: consented && typeof value.token === 'string' ? value.token : null,
    options: {
      language: (AI_LANGUAGES as readonly unknown[]).includes(options.language)
        ? (options.language as AiCommitOptions['language'])
        : base.options.language,
      conventional: options.conventional === true,
      length: (AI_LENGTHS as readonly unknown[]).includes(options.length)
        ? (options.length as AiCommitOptions['length'])
        : base.options.length,
    },
    registrations: {
      day: typeof registrations.day === 'string' ? registrations.day : '',
      count: typeof registrations.count === 'number' ? registrations.count : 0,
    },
  };
}

/** What "View the data that will be sent" shows — exactly what goes into the request body. */
export interface AiPreview {
  feature: AiFeature;
  branch: string | null;
  files: readonly AiDiffFile[];
  skipped: readonly AiSkippedFile[];
  redactions: number;
  subjects: readonly string[];
}

export interface PendingConsent {
  id: number;
  /** `consent`: ask before the first use; `preview`: just show the data. */
  mode: 'consent' | 'preview';
  preview: AiPreview;
  resolve: (accepted: boolean) => void;
}

export interface AiStoreOptions {
  client?: AiClient;
  storage?: KeyValueStorage | null;
  randomId?: () => string;
  now?: () => number;
}

function localDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export class AiStore {
  saved = $state<AiSaved>(defaults());
  quota = $state.raw<QuotaResponse | null>(null);
  pending = $state.raw<PendingConsent | null>(null);
  readonly client: AiClient;
  readonly #storage: KeyValueStorage | null;
  readonly #randomId: () => string;
  readonly #now: () => number;
  #serial = 0;
  #registering: Promise<AiIdentity> | null = null;

  constructor(options: AiStoreOptions = {}) {
    this.client =
      options.client ??
      new AiClient({
        baseUrl: import.meta.env.VITE_THAIGIT_API_URL || DEFAULT_API_URL,
        appVersion: import.meta.env.VITE_APP_VERSION ?? '',
      });
    this.#storage = options.storage === undefined ? browserStorage() : options.storage;
    this.#randomId = options.randomId ?? (() => crypto.randomUUID());
    this.#now = options.now ?? Date.now;
    let raw: unknown;
    try {
      const text = this.#storage?.getItem(AI_STORAGE_KEY);
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = null;
    }
    this.saved = sanitize(raw);
  }

  get consented(): boolean {
    return this.saved.consented;
  }

  /** A feature's remaining quota today (`null` while unknown). */
  remaining(feature: AiFeature): number | null {
    const entry = this.quota?.features[feature];
    return entry === undefined ? null : Math.max(0, entry.limit - entry.used);
  }

  /** Already consented → `true` right away; otherwise show the consent dialog (with the data that will be sent) and wait for the user's choice. */
  askConsent(preview: AiPreview): Promise<boolean> {
    if (this.saved.consented) return Promise.resolve(true);
    return this.#open('consent', preview);
  }

  /** Just view the data that will be sent (send nothing). */
  showPreview(preview: AiPreview): void {
    void this.#open('preview', preview);
  }

  answer(accepted: boolean): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    if (pending.mode === 'consent' && accepted) {
      this.saved.consented = true;
      this.#save();
    }
    pending.resolve(accepted && pending.mode === 'consent');
  }

  #open(mode: PendingConsent['mode'], preview: AiPreview): Promise<boolean> {
    this.pending?.resolve(false);
    return new Promise((resolve) => {
      this.pending = { id: ++this.#serial, mode, preview, resolve };
    });
  }

  setOptions(patch: Partial<AiCommitOptions>): void {
    this.saved.options = { ...this.saved.options, ...patch };
    this.#save();
  }

  /** Turn AI off: delete the consent, the install id and the token (using it again later requires new consent and a new id). */
  disable(): void {
    this.saved.consented = false;
    this.saved.installId = null;
    this.saved.token = null;
    this.quota = null;
    this.#save();
  }

  /** Install id + token; created / registered lazily on first use after consent. */
  async identity(): Promise<AiIdentity> {
    if (!this.saved.consented) throw new AiFailure('cancelled');
    const { installId, token } = this.saved;
    if (installId !== null && token !== null) return { installId, token };
    return this.#register();
  }

  #register(): Promise<AiIdentity> {
    this.#registering ??= (async () => {
      try {
        const day = localDay(this.#now());
        const used = this.saved.registrations.day === day ? this.saved.registrations.count : 0;
        if (used >= MAX_REGISTRATIONS_PER_DAY) throw new AiFailure('invalid_token');
        this.saved.registrations = { day, count: used + 1 };
        const installId = this.saved.installId ?? this.#randomId();
        this.saved.installId = installId;
        this.#save();
        const token = await this.client.register(installId);
        if (!this.saved.consented) throw new AiFailure('cancelled');
        this.saved.token = token;
        this.#save();
        return { installId, token };
      } finally {
        this.#registering = null;
      }
    })();
    return this.#registering;
  }

  async refreshQuota(): Promise<void> {
    if (!this.saved.consented) return;
    try {
      this.quota = await this.client.quota(await this.identity());
    } catch {
      // The remaining quota is display-only: if it cannot be read, so be it.
    }
  }

  /** Send one AI request; a rejected token triggers one re-registration and a retry. */
  async *run<F extends AiFeature>(
    feature: F,
    body: AiRequestByFeature[F],
    signal: AbortSignal,
  ): AsyncGenerator<AiFrame> {
    let identity = await this.identity();
    for (let attempt = 0; ; attempt += 1) {
      try {
        yield* this.client.stream(identity, feature, body, signal);
        return;
      } catch (error) {
        if (!(error instanceof AiFailure) || error.code !== 'invalid_token' || attempt > 0) throw error;
        this.saved.token = null;
        this.#save();
        identity = await this.#register();
      }
    }
  }

  #save(): void {
    try {
      this.#storage?.setItem(AI_STORAGE_KEY, JSON.stringify($state.snapshot(this.saved)));
    } catch {
      // Blocked / out of quota: only remembered for this session.
    }
  }
}

export const ai = new AiStore();
