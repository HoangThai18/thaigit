// In-memory rate limiting (a token bucket per key). Lost on restart — acceptable for per-minute limits.

export interface RateResult {
  ok: boolean;
  /** Seconds the caller must wait after being rejected. */
  retryAfter: number;
}

interface Bucket {
  tokens: number;
  updated: number;
}

export class RateLimiter {
  readonly #capacity: number;
  readonly #refillPerMs: number;
  readonly #buckets = new Map<string, Bucket>();
  #lastSweep = 0;

  /** `capacity` units per `windowMs` (refilled evenly). */
  constructor(capacity: number, windowMs: number) {
    this.#capacity = capacity;
    this.#refillPerMs = capacity / windowMs;
  }

  take(key: string, now: number): RateResult {
    this.#sweep(now);
    const bucket = this.#buckets.get(key) ?? { tokens: this.#capacity, updated: now };
    bucket.tokens = Math.min(this.#capacity, bucket.tokens + (now - bucket.updated) * this.#refillPerMs);
    bucket.updated = now;
    this.#buckets.set(key, bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { ok: true, retryAfter: 0 };
    }
    return { ok: false, retryAfter: Math.max(1, Math.ceil((1 - bucket.tokens) / this.#refillPerMs / 1000)) };
  }

  /** Return one unit (the request was rejected later, so it was never counted). */
  refund(key: string): void {
    const bucket = this.#buckets.get(key);
    if (bucket !== undefined) bucket.tokens = Math.min(this.#capacity, bucket.tokens + 1);
  }

  /** Drop buckets that have refilled completely (they no longer matter) so memory stays flat. */
  #sweep(now: number): void {
    if (now - this.#lastSweep < 60_000) return;
    this.#lastSweep = now;
    for (const [key, bucket] of this.#buckets) {
      if (bucket.tokens + (now - bucket.updated) * this.#refillPerMs >= this.#capacity)
        this.#buckets.delete(key);
    }
  }
}

/** In-memory per-day counter (e.g. new telemetryIds per IP per day). */
export class DailyCounter {
  #day = '';
  readonly #counts = new Map<string, number>();

  increment(day: string, key: string): number {
    if (day !== this.#day) {
      this.#day = day;
      this.#counts.clear();
    }
    const next = (this.#counts.get(key) ?? 0) + 1;
    this.#counts.set(key, next);
    return next;
  }
}
