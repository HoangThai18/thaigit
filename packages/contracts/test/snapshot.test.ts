import { describe, expect, it } from 'vitest';
import vectors from '../snapshot.vectors.json' with { type: 'json' };
import { gitPolicy, validateGitCommand } from '../src/policy.ts';
import {
  formatSnapshotMessage,
  parseSnapshotMessage,
  selectExpiredSnapshots,
  snapshotIdentityEnv,
  snapshotSpec,
  type SnapshotReason,
} from '../src/snapshot.ts';

interface ParseCase {
  message: string;
  expected: { reason: SnapshotReason; files: number | null } | null;
}

interface FormatCase {
  reason: SnapshotReason;
  files: number;
  expected: string;
}

interface ExpiredCase {
  times: number[];
  now: number;
  keepDays: number;
  keepCount: number;
  expected: number[];
}

describe('parseSnapshotMessage (ca dùng chung với Swift)', () => {
  for (const vector of vectors.parse as ParseCase[]) {
    it(JSON.stringify(vector.message), () => {
      expect(parseSnapshotMessage(vector.message)).toEqual(vector.expected);
    });
  }
});

describe('formatSnapshotMessage (ca dùng chung với Swift)', () => {
  for (const vector of vectors.format as FormatCase[]) {
    it(`${vector.reason} / ${vector.files}`, () => {
      const message = formatSnapshotMessage(vector.reason, vector.files);
      expect(message).toBe(vector.expected);
      expect(parseSnapshotMessage(message)).toEqual({ reason: vector.reason, files: vector.files });
    });
  }
});

describe('selectExpiredSnapshots (ca dùng chung với Swift)', () => {
  for (const vector of vectors.expired as ExpiredCase[]) {
    it(`${vector.times.length} mục, giữ ${vector.keepDays} ngày / ${vector.keepCount} mốc`, () => {
      const entries = vector.times.map((time, index) => ({ index, time }));
      expect(selectExpiredSnapshots(entries, vector.now, vector.keepDays, vector.keepCount)).toEqual(
        vector.expected,
      );
    });
  }
});

describe('snapshot.json khớp chính sách git', () => {
  it('danh tính cố định của snapshot là giá trị DUY NHẤT chính sách nhận cho GIT_AUTHOR_* / GIT_COMMITTER_*', () => {
    const env = snapshotIdentityEnv();
    for (const [key, value] of Object.entries(env)) {
      expect(gitPolicy.env.fromCaller[key]?.values).toEqual([value]);
    }
    expect(validateGitCommand('commit-tree', ['abc', '--no-gpg-sign', '-F', '-'], env)).toBeNull();
  });

  it('ref nằm trong không gian per-worktree, index tạm nằm trong thư mục con của git dir', () => {
    expect(snapshotSpec.ref.startsWith('refs/worktree/')).toBe(true);
    expect(snapshotSpec.indexFile.split('/')).toHaveLength(2);
    expect(snapshotSpec.reasons).toContain('auto');
  });
});
