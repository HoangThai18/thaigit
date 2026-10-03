import { describe, expect, it } from 'vitest';
import vectors from '../../contracts/risk-rules.vectors.json' with { type: 'json' };
import { addedLinesByPath, collectRiskInputs } from '../src/risk/collect.ts';
import { LARGE_FILE_BYTES, detectRisks, type RiskInput } from '../src/risk/risk-flags.ts';
import { withTestRepo } from './helpers/test-repo.ts';

interface Case {
  name: string;
  files: RiskInput[];
  expected: { code: string; paths: string[] }[];
}

describe('detectRisks (ca dùng chung với Swift)', () => {
  for (const vector of vectors.cases as Case[]) {
    it(vector.name, () => {
      expect(detectRisks(vector.files)).toEqual(vector.expected);
    });
  }
});

describe('collectRiskInputs (git thật)', () => {
  it('lấy dòng thêm từ diff HEAD, nội dung và kích thước file mới; xoá test thì có cờ', () =>
    withTestRepo(async (t) => {
      await t.write('src/a.test.ts', "it('chạy', () => {});\n");
      await t.write('src/app.ts', 'export const x = 1;\n');
      await t.commitAll('init');
      t.git('rm', '-q', 'src/a.test.ts');
      await t.write('src/app.ts', "export const x = 1;\nconst key = 'AKIAIOSFODNN7EXAMPLE';\n");
      await t.write('.env', 'DEBUG=1\n');
      await t.write('data/dump.bin', new Uint8Array(LARGE_FILE_BYTES + 10));
      await t.write('thư mục/mới.txt', 'xin chào\n');
      const status = await t.repo.status();
      const inputs = await collectRiskInputs(t.repo, status);
      const app = inputs.find((input) => input.path === 'src/app.ts');
      expect(app?.addedLines).toEqual(["const key = 'AKIAIOSFODNN7EXAMPLE';"]);
      expect(inputs.find((input) => input.path === 'thư mục/mới.txt')?.addedLines).toContain('xin chào');
      expect(inputs.find((input) => input.path === 'data/dump.bin')?.size).toBeGreaterThan(LARGE_FILE_BYTES);
      expect(detectRisks(inputs)).toEqual([
        { code: 'tests-removed', paths: ['src/a.test.ts'] },
        { code: 'large-file', paths: ['data/dump.bin'] },
        { code: 'secret', paths: ['.env', 'src/app.ts'] },
      ]);
    }));

  it('repo chưa có commit: đọc nội dung file mới', () =>
    withTestRepo(async (t) => {
      await t.write('tests/test_x.py', '@pytest.mark.skip\ndef test_x(): pass\n');
      const inputs = await collectRiskInputs(t.repo, await t.repo.status());
      expect(detectRisks(inputs)).toEqual([{ code: 'tests-skipped', paths: ['tests/test_x.py'] }]);
    }));
});

describe('addedLinesByPath', () => {
  it('tách theo file, bỏ dòng tiêu đề, xử lý file bị xoá và tên có nháy', () => {
    const patch = [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,0 +2 @@',
      '+++ b/không phải tiêu đề',
      'diff --git "a/t\\303\\252n.txt" "b/t\\303\\252n.txt"',
      '--- "a/t\\303\\252n.txt"',
      '+++ "b/t\\303\\252n.txt"',
      '@@ -0,0 +1 @@',
      '+mới',
      'diff --git a/x.txt b/x.txt',
      '--- a/x.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-cũ',
    ].join('\n');
    const result = addedLinesByPath(patch);
    expect(result.get('a.txt')).toEqual(['++ b/không phải tiêu đề']);
    expect(result.get('tên.txt')).toEqual(['mới']);
    expect(result.has('x.txt')).toBe(false);
  });
});
