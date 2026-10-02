// CommitDetail dựng bằng Svelte thật trên RepoStore + repo git thật.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import CommitDetail from '../../src/lib/inspector/CommitDetail.svelte';
import { openLoaded, setupEdge, until } from '../helpers/edge-repo.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('CommitDetail: commit có hai cha giống hệt (H2c)', () => {
  it('hiện đủ hai liên kết cha (không ném each_key_duplicate) và bấm vào vẫn chọn được commit cha', async () => {
    const repo = await openLoaded(setupEdge);
    cleanups.push(() => repo.cleanup());
    const entry = repo.store.entries.find((candidate) => candidate.commit.subject === 'dup parents');
    expect(entry).toBeDefined();
    const sha = entry!.commit.id;
    expect(entry!.commit.parents).toHaveLength(2);
    expect(entry!.commit.parents[0]).toBe(entry!.commit.parents[1]);

    repo.store.select({ kind: 'commit', sha });
    await until(() => repo.store.details?.commit.id === sha, 'chi tiết commit');
    const target = document.createElement('div');
    document.body.append(target);
    const app = mount(CommitDetail, { target, props: { store: repo.store, sha } });
    cleanups.push(() => {
      unmount(app);
      target.remove();
    });
    flushSync();
    await tick();

    const links = [...target.querySelectorAll<HTMLButtonElement>('.sha-link')];
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      entry!.commit.parents[0]!.slice(0, 7),
      entry!.commit.parents[0]!.slice(0, 7),
    ]);
    links[1]?.click();
    expect(repo.store.selection).toEqual({ kind: 'commit', sha: entry!.commit.parents[0] });
  });
});
