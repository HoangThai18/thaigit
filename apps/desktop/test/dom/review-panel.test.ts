// ReviewPanel dựng bằng Svelte thật trên RepoStore + repo git thật: chữ từ máy chủ chỉ là text, GitLab gọi là Merge Request,
// bấm file mở đúng diff, các trạng thái đang tải / lỗi có lối thử lại.
import { flushSync, mount, tick, unmount } from 'svelte';
import type { ForgeMergeRequest } from '@thaigit/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import ReviewPanel from '../../src/lib/forge/ReviewPanel.svelte';
import { vi } from '../../src/lib/strings.vi.ts';
import { stubLayout } from '../helpers/dom-layout.ts';
import { openLoaded, setupEdge, until, type LoadedRepo } from '../helpers/edge-repo.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function request(partial: Partial<ForgeMergeRequest> = {}): ForgeMergeRequest {
  return {
    host: 'gitlab.com',
    number: '12',
    title: 'Sửa lỗi đăng nhập',
    body: 'Dòng một\nDòng hai',
    author: 'bob',
    sourceBranch: 'fix/login',
    targetBranch: 'main',
    state: 'open',
    draft: false,
    webUrl: 'https://gitlab.com/acme/app/-/merge_requests/12',
    headHost: 'gitlab.com',
    headOwner: 'acme',
    updatedAt: '2026-10-05T10:00:00Z',
    commits: 3,
    ...partial,
  };
}

async function mountPanel(): Promise<{ repo: LoadedRepo; root: HTMLElement }> {
  const repo = await openLoaded(setupEdge);
  const restore = stubLayout({ width: 360, height: 600 });
  cleanups.push(() => repo.cleanup());
  cleanups.push(restore);
  const root = document.createElement('div');
  document.body.append(root);
  const app = mount(ReviewPanel, { target: root, props: { store: repo.store } });
  cleanups.push(() => {
    unmount(app);
    root.remove();
  });
  return { repo, root };
}

describe('ReviewPanel', () => {
  it('đang tải rồi hiện file; GitLab gọi là Merge Request !12; bấm file mở diff của PR', async () => {
    const { repo, root } = await mountPanel();
    const store = repo.store;
    const head = store.headOid!;
    const files = (await store.git.changedFiles(head, null)).slice(0, 2);
    expect(files.length).toBeGreaterThan(0);

    const token = store.review.begin(request(), 'gitlab');
    flushSync();
    await tick();
    expect(root.querySelector('.kind')?.textContent).toBe('Merge Request !12');
    expect(root.querySelector('[role="status"]')?.textContent).toContain(vi.pullRequests.reviewLoading);

    store.review.finish(token, { head, from: head, files });
    flushSync();
    await tick();
    const rows = [...root.querySelectorAll<HTMLElement>('.file')];
    expect(rows).toHaveLength(files.length);
    expect(root.textContent).toContain(vi.pullRequests.reviewFiles(files.length));
    expect(root.textContent).toContain(vi.pullRequests.reviewCommits(3));

    rows[0]!.click();
    flushSync();
    expect(repo.store.diff.file?.source).toEqual({ kind: 'commit', sha: head, parent: head, label: '!12' });
    expect(repo.store.diff.file?.change.path).toBe(files[0]!.path);
    await tick();
    expect(rows[0]!.classList.contains('selected')).toBe(true);
  });

  it('GitHub gọi là Pull Request #7, nhãn Nháp; chữ lạ từ máy chủ chỉ là text, không thành thẻ HTML', async () => {
    const { repo, root } = await mountPanel();
    const hostile = '<img src=x onerror="window.__pwned=1"><b>đậm</b>';
    const token = repo.store.review.begin(
      request({
        number: '7',
        draft: true,
        title: hostile,
        body: hostile,
        author: hostile,
        sourceBranch: hostile,
      }),
      'github',
    );
    repo.store.review.finish(token, { head: 'a', from: 'b', files: [] });
    flushSync();
    await tick();
    expect(root.querySelector('.kind')?.textContent).toBe('Pull Request #7');
    expect(root.querySelector('.tag')?.textContent).toBe(vi.pullRequests.draft);
    expect(root.querySelector('img, b')).toBeNull();
    expect(root.textContent).toContain(hostile);
    expect(root.textContent).toContain(vi.pullRequests.reviewNoFiles);
  });

  it('lỗi: báo thất bại kèm nút thử lại; nút đóng đóng panel', async () => {
    const { repo, root } = await mountPanel();
    const token = repo.store.review.begin(request({ body: '' }), null);
    repo.store.review.fail(token);
    flushSync();
    await tick();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(vi.pullRequests.reviewFailed);
    expect(root.textContent).toContain(vi.pullRequests.reviewNoDescription);
    const retry = [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes(vi.pullRequests.reviewRetry),
    );
    expect(retry).toBeDefined();

    root.querySelector<HTMLButtonElement>('button.close')!.click();
    flushSync();
    expect(repo.store.review.isOpen).toBe(false);
    await until(() => root.querySelector('.review') === null, 'panel biến mất');
  });
});
