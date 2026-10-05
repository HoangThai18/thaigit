// The gateway to the model: at most `concurrency` generations run in parallel, the rest queue (up to `queueMax`, waiting at
// most `timeoutMs`). Priority: installs that are "familiar" (successful on ≥ 2 distinct days) go first; a new install may
// hold at most half the slots, and when the queue is full a familiar install can push a new one out — so spamming fresh
// ids cannot lock out long-time users.

export class AdmissionRejected extends Error {
  readonly reason: 'timeout' | 'evicted';

  constructor(reason: 'timeout' | 'evicted') {
    super(reason);
    this.reason = reason;
  }
}

export interface AdmissionTicket {
  /** Wait for a turn. `onPosition` fires whenever the queue position (1 = next) changes. Timeout / pushed out → reject. */
  wait(onPosition: (position: number) => void): Promise<void>;
  /** Return the slot (or leave the queue). Safe to call more than once. */
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
   * Entering: a slot is free, or there is room in the queue, or `null` (queue full → return `ai_busy` immediately, without
   * opening a stream).
   * A familiar install meeting a full queue pushes the newest newcomer out.
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

    // After every #pump nobody from the queue got in immediately, so whoever qualifies right now going straight in is fair.
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
    // A familiar install queues after the last familiar one (ahead of every newcomer); newcomers go last.
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

  /** Admit the queue's head (when it qualifies) once a slot frees up. */
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
