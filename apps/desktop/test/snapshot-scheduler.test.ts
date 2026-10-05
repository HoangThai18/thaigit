import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdapterError } from '@thaigit/core';
import { SnapshotScheduler, type SchedulerDeps } from '../src/lib/snapshots/scheduler.ts';

const QUIET = 20_000;
const MIN_INTERVAL = 120_000;
const PRUNE_INTERVAL = 3_600_000;

function harness(overrides: Partial<SchedulerDeps> = {}) {
  const calls = { take: 0, prune: 0 };
  const state = { enabled: true, busy: false };
  const deps: SchedulerDeps = {
    quietMs: QUIET,
    minIntervalMs: MIN_INTERVAL,
    pruneIntervalMs: PRUNE_INTERVAL,
    enabled: () => state.enabled,
    busy: () => state.busy,
    take: async () => {
      calls.take++;
    },
    prune: async () => {
      calls.prune++;
    },
    ...overrides,
  };
  const scheduler = new SnapshotScheduler(deps);
  return { scheduler, calls, state };
}

/** Run every due timer to completion and let the inner promises (take / prune) finish. */
async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SnapshotScheduler', () => {
  it('chờ file yên rồi mới chụp; mỗi thay đổi mới đẩy lùi lần chụp', async () => {
    const { scheduler, calls } = harness();
    scheduler.notifyChange();
    await advance(QUIET - 1000);
    scheduler.notifyChange();
    await advance(QUIET - 1000);
    expect(calls.take).toBe(0);
    await advance(1000);
    expect(calls.take).toBe(1);
    scheduler.dispose();
  });

  it('không chụp dày hơn khoảng tối thiểu, nhưng thay đổi trong lúc chờ vẫn được chụp sau đó', async () => {
    const { scheduler, calls } = harness();
    scheduler.notifyChange();
    await advance(QUIET);
    expect(calls.take).toBe(1);
    scheduler.notifyChange();
    await advance(QUIET);
    expect(calls.take).toBe(1);
    await advance(MIN_INTERVAL - QUIET);
    expect(calls.take).toBe(2);
    await advance(MIN_INTERVAL * 3);
    expect(calls.take).toBe(2);
    scheduler.dispose();
  });

  it('tắt cho repo thì không chụp; repo đang bận thì thử lại sau', async () => {
    const { scheduler, calls, state } = harness();
    state.enabled = false;
    scheduler.notifyChange();
    await advance(QUIET * 2);
    expect(calls.take).toBe(0);

    state.enabled = true;
    state.busy = true;
    scheduler.notifyChange();
    await advance(QUIET);
    expect(calls.take).toBe(0);
    state.busy = false;
    await advance(QUIET);
    expect(calls.take).toBe(1);
    scheduler.dispose();
  });

  it('lỗi busy từ Rust (repo bận ở cửa sổ khác) thì thử lại; lỗi khác thì bỏ qua lần này, không lặp dồn dập', async () => {
    let fail: unknown = new AdapterError('busy', 'Repo đang bận');
    let attempts = 0;
    const { scheduler } = harness({
      take: async () => {
        attempts++;
        if (fail) throw fail;
      },
    });
    scheduler.notifyChange();
    await advance(QUIET);
    expect(attempts).toBe(1);
    fail = new Error('hỏng');
    await advance(QUIET);
    expect(attempts).toBe(2);
    await advance(MIN_INTERVAL * 2);
    expect(attempts).toBe(2);
    scheduler.dispose();
  });

  it('dọn mốc cũ sau lần chụp đầu và tối đa mỗi giờ một lần', async () => {
    const { scheduler, calls } = harness();
    scheduler.notifyChange();
    await advance(QUIET);
    expect(calls.prune).toBe(1);
    for (let index = 0; index < 5; index++) {
      scheduler.notifyChange();
      await advance(MIN_INTERVAL);
    }
    expect(calls.take).toBe(6);
    expect(calls.prune).toBe(1);
    await advance(PRUNE_INTERVAL);
    scheduler.notifyChange();
    await advance(MIN_INTERVAL);
    expect(calls.prune).toBe(2);
    scheduler.dispose();
  });

  it('dispose huỷ lần chụp đang hẹn', async () => {
    const { scheduler, calls } = harness();
    scheduler.notifyChange();
    scheduler.dispose();
    await advance(QUIET * 10);
    expect(calls.take).toBe(0);
  });
});
