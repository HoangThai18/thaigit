// Talks to Thaigit's AI API (`server/`) using the webview's own fetch (the server allows the app's origin
// via CORS; the CSP `connect-src` only opens that one domain). Every failure becomes an `AiFailure` with a
// contracts code — the UI turns codes into a friendly sentence and never shows the original message.

import {
  AI_HEADERS,
  AI_ROUTES,
  parseAiErrorBody,
  parseQuotaResponse,
  type AiErrorCode,
  type AiFeature,
  type AiFrame,
  type AiRequestByFeature,
  type QuotaResponse,
} from '@thaigit/contracts';
import { readAiFrames } from '@thaigit/core';

/** Default server; a test build may override it with `VITE_THAIGIT_API_URL`. */
export const DEFAULT_API_URL = 'https://git.thaipro.store';

export type AiFailureCode = AiErrorCode | 'network' | 'cancelled' | 'empty';

export class AiFailure extends Error {
  readonly code: AiFailureCode;
  /** Seconds to wait (from `Retry-After`) for `ai_busy` / `ip_rate_limited`. */
  readonly retryAfter: number | undefined;

  constructor(code: AiFailureCode, retryAfter?: number) {
    super(`ai:${code}`);
    this.name = 'AiFailure';
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export interface AiIdentity {
  installId: string;
  token: string;
}

export interface AiClientOptions {
  baseUrl: string;
  appVersion: string;
  fetch?: typeof fetch;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export class AiClient {
  readonly #baseUrl: string;
  readonly #appVersion: string;
  readonly #fetch: typeof fetch;

  constructor(options: AiClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#appVersion = options.appVersion;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  #headers(identity: AiIdentity | null): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(identity ? { [AI_HEADERS.installId]: identity.installId, [AI_HEADERS.token]: identity.token } : {}),
      ...(this.#appVersion !== '' ? { [AI_HEADERS.appVersion]: this.#appVersion } : {}),
    };
  }

  async #request(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, init);
    } catch (error) {
      throw new AiFailure(isAbort(error) ? 'cancelled' : 'network');
    }
    if (response.ok) return response;
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Not JSON (a proxy returned an error page…): fall back to guessing from the HTTP status.
    }
    const parsed = parseAiErrorBody(body);
    const header = Number(response.headers.get('Retry-After'));
    const retryAfter = parsed?.retryAfter ?? (Number.isFinite(header) && header > 0 ? header : undefined);
    if (parsed) throw new AiFailure(parsed.code, retryAfter);
    if (response.status === 401) throw new AiFailure('invalid_token');
    if (response.status === 413) throw new AiFailure('too_large');
    if (response.status === 429) throw new AiFailure('ip_rate_limited', retryAfter ?? 30);
    if (response.status >= 500) throw new AiFailure('ai_unavailable');
    throw new AiFailure('bad_request');
  }

  /** Register this install (only called after the user opted in to AI) → token. */
  async register(installId: string): Promise<string> {
    const response = await this.#request('/v1/ai/install', {
      method: 'POST',
      headers: this.#headers(null),
      body: JSON.stringify({ aiInstallId: installId }),
    });
    const body = (await response.json().catch(() => null)) as { token?: unknown } | null;
    if (typeof body?.token !== 'string' || body.token === '') throw new AiFailure('internal');
    return body.token;
  }

  async quota(identity: AiIdentity, signal?: AbortSignal): Promise<QuotaResponse> {
    const response = await this.#request('/v1/ai/quota', {
      headers: this.#headers(identity),
      ...(signal ? { signal } : {}),
    });
    const quota = parseQuotaResponse(await response.json().catch(() => null));
    if (quota === null) throw new AiFailure('internal');
    return quota;
  }

  /**
   * Send the context, return the frames in real time. A failure before the stream (HTTP 4xx/5xx) throws
   * `AiFailure`; a failure inside the stream arrives as an `error` frame. Cancel with `signal`.
   */
  async *stream<F extends AiFeature>(
    identity: AiIdentity,
    feature: F,
    body: AiRequestByFeature[F],
    signal: AbortSignal,
  ): AsyncGenerator<AiFrame> {
    const response = await this.#request(AI_ROUTES[feature], {
      method: 'POST',
      headers: { ...this.#headers(identity), Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
    if (response.body === null) throw new AiFailure('ai_unavailable');
    try {
      yield* readAiFrames(response.body);
    } catch (error) {
      throw new AiFailure(signal.aborted || isAbort(error) ? 'cancelled' : 'network');
    }
  }
}
