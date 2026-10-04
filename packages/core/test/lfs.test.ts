// Git LFS: parser thuần + thao tác trên git-lfs thật (qua NodeExec + chính sách). Máy không có git-lfs thì bỏ qua phần git thật.
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseLfsPatterns, parseLfsPointer } from '../src/git/index.ts';
import { openRepository } from '../src/node/index.ts';
import { isolatedConfig, rawGit, withTestRepo } from './helpers/test-repo.ts';

const HAS_LFS = spawnSync('git', ['lfs', 'version']).status === 0;

describe('parser', () => {
  it('parseLfsPatterns: chỉ mẫu có filter=lfs, giữ mẫu gốc, hiện khoảng trắng, lockable, nháy kép', () => {
    const text = [
      '# chú thích *.x filter=lfs',
      '*.psd filter=lfs diff=lfs merge=lfs -text',
      'my[[:space:]]file.bin filter=lfs diff=lfs merge=lfs -text\r',
      '*.png filter=lfs diff=lfs merge=lfs -text lockable',
      '*.txt text eol=lf',
      'assets/*.bin !filter !diff !merge',
      '"thư mục/có \\"nháy\\".bin" filter=lfs',
      '   ',
      'chi-mau-khong-thuoc-tinh',
    ].join('\n');
    expect(parseLfsPatterns(text)).toEqual([
      { pattern: '*.psd', display: '*.psd', lockable: false },
      { pattern: 'my[[:space:]]file.bin', display: 'my file.bin', lockable: false },
      { pattern: '*.png', display: '*.png', lockable: true },
      { pattern: 'thư mục/có "nháy".bin', display: 'thư mục/có "nháy".bin', lockable: false },
    ]);
    expect(parseLfsPatterns('')).toEqual([]);
  });

  it('parseLfsPointer: đúng spec v1 mới nhận', () => {
    const oid = 'a'.repeat(64);
    const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 12345\n`;
    expect(parseLfsPointer(pointer)).toEqual({ oid, size: 12345 });
    expect(parseLfsPointer(pointer.replace('size 12345', 'size x'))).toBeNull();
    expect(parseLfsPointer(`xin chào\n${pointer}`)).toBeNull();
    expect(parseLfsPointer(pointer + 'x'.repeat(2000))).toBeNull();
  });
});

describe.skipIf(!HAS_LFS)('git-lfs thật', () => {
  it('track / untrack sửa .gitattributes; push lên remote rồi pull ở bản clone; prune', () =>
    withTestRepo(async (t) => {
      expect(await t.repo.lfsVersion()).toMatch(/^\d+\.\d+/);
      expect(await t.repo.lfsPatterns()).toEqual([]);
      t.git('lfs', 'install', '--local');

      await t.repo.lfsTrack('*.bin');
      await t.repo.lfsTrack('my file.dat');
      expect((await t.repo.lfsPatterns()).map((item) => item.display)).toEqual(['*.bin', 'my file.dat']);
      const spaced = (await t.repo.lfsPatterns())[1]!;
      await t.repo.lfsUntrack(spaced.pattern);
      expect((await t.repo.lfsPatterns()).map((item) => item.pattern)).toEqual(['*.bin']);

      const content = 'nội dung lớn\n'.repeat(100);
      await t.write('a.bin', content);
      await t.commitAll('thêm file LFS');
      // Trong git, file chỉ còn là con trỏ.
      const blob = t.git('cat-file', '-p', 'HEAD:a.bin');
      expect(parseLfsPointer(blob)?.size).toBe(Buffer.byteLength(content));

      const bare = join(t.root, '..', 'remote.git');
      rawGit(join(t.root, '..'), ['init', '-q', '--bare', bare]);
      t.git('remote', 'add', 'origin', pathToFileURL(bare).href);
      await t.repo.lfsPush('origin', 'main');
      t.git('push', '-q', '--no-verify', 'origin', 'main');
      expect(await readdir(join(bare, 'lfs', 'objects'))).not.toEqual([]);

      // Clone không có bộ lọc LFS: working tree chỉ có con trỏ; `lfs pull` thay bằng file thật.
      const clone = join(t.root, '..', 'ban-clone');
      rawGit(join(t.root, '..'), ['clone', '-q', '-b', 'main', pathToFileURL(bare).href, clone]);
      expect(parseLfsPointer(await readFile(join(clone, 'a.bin'), 'utf8'))).not.toBeNull();
      rawGit(clone, ['lfs', 'install', '--local']);
      const cloned = await openRepository(clone, isolatedConfig());
      expect((await cloned.lfsPatterns()).map((item) => item.pattern)).toEqual(['*.bin']);
      await cloned.lfsFetch(true);
      expect(await readFile(join(clone, 'a.bin'), 'utf8')).toBe(content);
      await cloned.lfsFetch(false);
      await cloned.lfsPrune();

      await expect(t.repo.lfsPush('--all', 'main')).rejects.toThrow();
    }));
});
