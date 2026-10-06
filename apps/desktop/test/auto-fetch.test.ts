// Auto-fetch: backoff calculation + memoised branch-tree rebuild.
import type { GitRef } from '@thaigit/core';
import { describe, expect, it } from 'vitest';
import { backoffMs } from '../src/lib/actions/autoFetch.ts';
import { buildBranchTree } from '../src/lib/sidebar/tree.ts';

describe('backoffMs', () => {
  it('is 0 while healthy', () => {
    expect(backoffMs(0, 60_000)).toBe(0);
    expect(backoffMs(-3, 60_000)).toBe(0);
  });

  it('doubles with each consecutive failure', () => {
    expect(backoffMs(1, 60_000)).toBe(120_000);
    expect(backoffMs(2, 60_000)).toBe(240_000);
    expect(backoffMs(3, 60_000)).toBe(480_000);
  });

  it('is capped at one hour', () => {
    expect(backoffMs(20, 60_000)).toBe(60 * 60_000);
  });
});

describe('buildBranchTree', () => {
  const refs = [
    { fullName: 'refs/heads/feature/a' },
    { fullName: 'refs/heads/feature/b' },
  ] as unknown as readonly GitRef[];
  const nameOf = (ref: GitRef) => ref.fullName.slice('refs/heads/'.length);

  it('returns the cached array by identity when called with the same inputs', () => {
    const first = buildBranchTree(refs, nameOf);
    const second = buildBranchTree(refs, nameOf);
    expect(second).toBe(first);
  });

  it('rebuilds when a new refs array is passed', () => {
    const first = buildBranchTree(refs, nameOf);
    const copied = refs.slice() as typeof refs;
    const second = buildBranchTree(copied, nameOf);
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });
});
