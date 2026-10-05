// Repos missing remote branches / history (`--single-branch`, `--depth` clones): detection and fetching the rest — real git.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseFetchRefspecs, tracksAllBranches } from '../src/git/index.ts';
import { openRepository } from '../src/node/index.ts';
import {
  cloneTestRepo,
  createBareRemote,
  isolatedConfig,
  rawGit,
  withTempDir,
  withTestRepo,
} from './helpers/test-repo.ts';

describe('refspec fetch', () => {
  it('nhận ra refspec lấy mọi nhánh, bỏ qua refspec một nhánh và refspec loại trừ', () => {
    expect(tracksAllBranches(['+refs/heads/*:refs/remotes/origin/*'])).toBe(true);
    expect(tracksAllBranches(['refs/heads/*:refs/remotes/origin/*'])).toBe(true);
    expect(tracksAllBranches(['+refs/heads/main:refs/remotes/origin/main'])).toBe(false);
    expect(tracksAllBranches(['^refs/heads/*'])).toBe(false);
    expect(tracksAllBranches([])).toBe(false);
  });

  it('tách output config -z theo remote, giữ hoa thường và dấu chấm trong tên remote', () => {
    const output =
      'remote.origin.fetch\n+refs/heads/main:refs/remotes/origin/main\0' +
      'remote.Gitlab.Mirror.fetch\n+refs/heads/*:refs/remotes/Gitlab.Mirror/*\0' +
      'remote.origin.fetch\n+refs/heads/dev:refs/remotes/origin/dev\0';
    const parsed = parseFetchRefspecs(output);
    expect(parsed.get('origin')).toEqual([
      '+refs/heads/main:refs/remotes/origin/main',
      '+refs/heads/dev:refs/remotes/origin/dev',
    ]);
    expect(parsed.get('Gitlab.Mirror')).toEqual(['+refs/heads/*:refs/remotes/Gitlab.Mirror/*']);
    expect(parseFetchRefspecs('')).toEqual(new Map());
  });
});

describe('historyGaps / trackAllBranches / unshallow', () => {
  it('clone --single-branch --depth 1: thiếu nhánh và lịch sử → lấy đủ sau khi sửa', () =>
    withTempDir(async (parent) => {
      const config = isolatedConfig();
      const bare = await createBareRemote(parent, config);
      const seed = join(parent, 'seed');
      for (const name of ['b.txt', 'c.txt']) {
        rawGit(seed, ['commit', '--allow-empty', '-m', `main ${name}`], config);
      }
      rawGit(seed, ['push', bare, 'main'], config);
      rawGit(seed, ['switch', '-c', 'feature/x'], config);
      rawGit(seed, ['commit', '--allow-empty', '-m', 'feature'], config);
      rawGit(seed, ['push', bare, 'feature/x'], config);

      // `--depth` is ignored for local paths — a file:// URL is required.
      const dir = join(parent, 'shallow');
      rawGit(
        parent,
        ['clone', '-q', '--single-branch', '--branch', 'main', '--depth', '1', pathToFileURL(bare).href, dir],
        config,
      );
      const repo = await openRepository(dir, config);

      expect(await repo.historyGaps()).toEqual({ shallow: true, narrowRemotes: ['origin'] });
      expect((await repo.log({ limit: 50, order: 'topo', includeHead: true })).length).toBe(1);

      await repo.trackAllBranches('origin');
      await repo.unshallow('origin');
      await repo.fetch({});

      expect(await repo.historyGaps()).toEqual({ shallow: false, narrowRemotes: [] });
      const names = (await repo.refs()).map((ref) => ref.fullName);
      expect(names).toContain('refs/remotes/origin/feature/x');
      expect((await repo.log({ limit: 50, order: 'topo', includeHead: true })).length).toBe(4);
      // The old refspec is kept (the all-branches refspec is only ADDED).
      expect(rawGit(dir, ['config', '--get-all', 'remote.origin.fetch'], config).trim().split('\n')).toEqual([
        '+refs/heads/main:refs/remotes/origin/main',
        '+refs/heads/*:refs/remotes/origin/*',
      ]);
    }));

  it('clone bình thường và repo không có remote: không thiếu gì', () =>
    withTempDir(async (parent) => {
      const config = isolatedConfig();
      const bare = await createBareRemote(parent, config);
      const clone = await cloneTestRepo(parent, bare, 'a', config);
      expect(await clone.repo.historyGaps()).toEqual({ shallow: false, narrowRemotes: [] });
      await withTestRepo(async (t) => {
        expect(await t.repo.historyGaps()).toEqual({ shallow: false, narrowRemotes: [] });
      });
    }));

  it('tên remote bắt đầu bằng "-" bị từ chối trước khi chạy git', async () =>
    withTestRepo(async (t) => {
      await expect(t.repo.trackAllBranches('-x')).rejects.toThrow();
      await expect(t.repo.unshallow('--upload-pack=x')).rejects.toThrow();
    }));
});
