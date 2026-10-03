// Cửa vào model: tối đa `concurrency` generation chạy song song, phần còn lại xếp hàng (tối đa `queueMax`, chờ tối đa
// `timeoutMs`). Ưu tiên: cài đặt "quen" (đã dùng thành công ở ≥ 2 ngày khác nhau) đứng trước; cài đặt mới chỉ được giữ
// tối đa ½ số slot, và khi hàng đợi đầy thì người quen đẩy được người mới ra — spam bằng ID mới không chặn được người
// dùng cũ.

export class AdmissionRejected extends Error {
  readonly reason: 'timeout' | 'evicted';

  constructor(reason: 'timeout' | 'evicted') {
    super(reason);
    this.reason = reason;
  }
}

export interface AdmissionTicket {
  /** Chờ tới lượt. `onPosition` được gọi mỗi khi vị trí trong hàng (1 = kế tiếp) đổi. Hết giờ / bị đẩy → reject. */
  wait(onPosition: (position: number) => void): Promise<void>;
  /** Trả slot (hoặc rời hàng). Gọi nhiều lần vô hại. */
  release(): void;
}

interface Waiter {
  veteran: boolean;
  seq: number;
  resolve: () => void;
  reject: (error: AdmissionRejected) => void;
  onPosition: (position: number) => void;
  lastPosition: number;
  timer: ReturnType<typeof setTimeout> | null;
  waiting: boolean;
}

export class Admission {
  readonly #concurrency: number;
  readonly #newcomerSlots: number;
  readonly #queueMax: number;
  readonly #timeoutMs: number;
  #running = 0;
  #runningNewcomers = 0;
  #seq = 0;
  readonly #queue: Waiter[] = [];

  constructor(options: { concurrency: number; queueMax: number; timeoutMs: number }) {
    this.#concurrency = options.concurrency;
    this.#newcomerSlots = Math.max(1, Math.floor(options.concurrency / 2));
    this.#queueMax = options.queueMax;
    this.#timeoutMs = options.timeoutMs;
  }

  get running(): number {
    return this.#running;
  }

  get queued(): number {
    return this.#queue.length;
  }

  /**
   * Vào cửa: được slot ngay, hoặc có chỗ trong hàng, hoặc `null` (hàng đầy — trả `ai_busy` ngay, chưa mở stream).
   * Người quen gặp hàng đầy thì đẩy người mới xếp sau cùng ra.
   */
  enter(veteran: boolean): AdmissionTicket | null {
    let state: 'queued' | 'running' | 'done' = 'queued';
    const waiter: Waiter = {
      veteran,
      seq: (this.#seq += 1),
      resolve: () => {},
      reject: () => {},
      onPosition: () => {},
      lastPosition: 0,
      timer: null,
      waiting: false,
    };
    const release = () => {
      if (state === 'running') {
        this.#running -= 1;
        if (!veteran) this.#runningNewcomers -= 1;
        state = 'done';
        this.#pump();
      } else if (state === 'queued') {
        state = 'done';
        this.#remove(waiter);
      }
    };
    const start = () => {
      state = 'running';
      this.#running += 1;
      if (!veteran) this.#runningNewcomers += 1;
    };

    // Sau mỗi lần #pump không còn ai trong hàng vào được ngay, nên ai đủ điều kiện lúc này vào thẳng là công bằng.
    if (this.#canStart(veteran)) {
      start();
      return { wait: () => Promise.resolve(), release };
    }
    if (this.#queue.length >= this.#queueMax) {
      const victim = veteran ? this.#lastNewcomer() : null;
      if (victim === null) return null;
      this.#remove(victim);
      victim.reject(new AdmissionRejected('evicted'));
    }
    const promise = new Promise<void>((resolve, reject) => {
      waiter.resolve = () => {
        start();
        resolve();
      };
      waiter.reject = (error) => {
        state = 'done';
        reject(error);
      };
    });
    promise.catch(() => {});
    this.#insert(waiter);
    return {
      wait: (onPosition) => {
        waiter.onPosition = onPosition;
        waiter.waiting = true;
        if (state === 'queued') {
          waiter.timer = setTimeout(() => {
            if (state !== 'queued') return;
            this.#remove(waiter);
            waiter.reject(new AdmissionRejected('timeout'));
          }, this.#timeoutMs);
          this.#notifyPositions();
        }
        return promise;
      },
      release,
    };
  }

  #canStart(veteran: boolean): boolean {
    if (this.#running >= this.#concurrency) return false;
    return veteran || this.#runningNewcomers < this.#newcomerSlots;
  }

  #insert(waiter: Waiter): void {
    // Người quen đứng sau người quen cuối cùng (trước mọi người mới); người mới xếp cuối.
    const index = waiter.veteran ? this.#queue.findIndex((item) => !item.veteran) : -1;
    if (index === -1) this.#queue.push(waiter);
    else this.#queue.splice(index, 0, waiter);
    this.#notifyPositions();
  }

  #remove(waiter: Waiter): void {
    const index = this.#queue.indexOf(waiter);
    if (index !== -1) this.#queue.splice(index, 1);
    if (waiter.timer !== null) clearTimeout(waiter.timer);
    this.#notifyPositions();
  }

  #lastNewcomer(): Waiter | null {
    for (let index = this.#queue.length - 1; index >= 0; index -= 1) {
      const item = this.#queue[index];
      if (item !== undefined && !item.veteran) return item;
    }
    return null;
  }

  /** Cho người đầu hàng (đủ điều kiện) vào khi có slot trống. */
  #pump(): void {
    for (let index = 0; index < this.#queue.length;) {
      const waiter = this.#queue[index];
      if (waiter === undefined) break;
      if (this.#running >= this.#concurrency) break;
      if (!this.#canStart(waiter.veteran)) {
        index += 1;
        continue;
      }
      this.#queue.splice(index, 1);
      if (waiter.timer !== null) clearTimeout(waiter.timer);
      waiter.resolve();
    }
    this.#notifyPositions();
  }

  #notifyPositions(): void {
    this.#queue.forEach((waiter, index) => {
      if (!waiter.waiting || waiter.lastPosition === index + 1) return;
      waiter.lastPosition = index + 1;
      waiter.onPosition(index + 1);
    });
  }
}
