// Giới hạn tốc độ trong bộ nhớ (token bucket theo khoá). Mất khi khởi động lại — chấp nhận được với giới hạn theo phút.

export interface RateResult {
  ok: boolean;
  /** Giây phải chờ khi bị từ chối. */
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

  /** `capacity` lượt mỗi `windowMs` (nạp lại đều). */
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

  /** Trả lại một lượt (request bị từ chối ở bước sau, không tính). */
  refund(key: string): void {
    const bucket = this.#buckets.get(key);
    if (bucket !== undefined) bucket.tokens = Math.min(this.#capacity, bucket.tokens + 1);
  }

  /** Dọn bucket đã đầy lại (không còn ảnh hưởng) để bộ nhớ không phình. */
  #sweep(now: number): void {
    if (now - this.#lastSweep < 60_000) return;
    this.#lastSweep = now;
    for (const [key, bucket] of this.#buckets) {
      if (bucket.tokens + (now - bucket.updated) * this.#refillPerMs >= this.#capacity)
        this.#buckets.delete(key);
    }
  }
}

/** Đếm theo ngày trong bộ nhớ (vd. số telemetryId mới mỗi IP mỗi ngày). */
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
