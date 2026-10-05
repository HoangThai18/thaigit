import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import type { ForgeMergeRequest } from '@thaigit/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { openReview } from '../src/lib/forge/openReview.ts';
import { pullRequestReview, requestStateLabel } from '../src/lib/forge/pullRequests.ts';
import type { RepoForgeTarget } from '../src/lib/forge/target.ts';
import { PrefsStore } from '../src/lib/stores/prefs.svelte.ts';
import { RepoStore } from '../src/lib/stores/repo.svelte.ts';
import { ToastStore } from '../src/lib/stores/toasts.svelte.ts';
import { vi } from '../src/lib/strings.vi.ts';
import { openTestPort, rawGit } from './helpers/node-port.ts';

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function until(condition: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Hết giờ chờ: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function pr(partial: Partial<ForgeMergeRequest>): ForgeMergeRequest {
  return {
    host: 'github.com',
    number: '42',
    title: 'Thêm tính năng',
    body: 'Mô tả PR',
    author: 'bob',
    sourceBranch: 'feat',
    targetBranch: 'main',
    state: 'open',
    draft: false,
    webUrl: 'https://github.com/acme/app/pull/42',
    headHost: 'github.com',
    headOwner: 'acme',
    updatedAt: '',
    commits: 1,
    assignees: [],
    reviewers: [],
    ...partial,
  };
}

describe('pullRequestReview', () => {
  it('PR cùng repo: fetch nhánh nguồn và nhánh đích trong một lần, so sánh hai ref remote-tracking', () => {
    expect(pullRequestReview(pr({}), 'github', 'Acme', 'origin')).toEqual({
      refspecs: ['+refs/heads/feat:refs/remotes/origin/feat', '+refs/heads/main:refs/remotes/origin/main'],
      headRef: 'refs/remotes/origin/feat',
      baseRef: 'refs/remotes/origin/main',
    });
  });

  it('PR từ fork: lấy ref của PR trên repo đích (GitHub refs/pull, GitLab refs/merge-requests)', () => {
    const fork = pr({ number: '7', headOwner: 'someone' });
    expect(pullRequestReview(fork, 'github', 'acme', 'origin')?.refspecs[0]).toBe(
      '+refs/pull/7/head:refs/remotes/origin/pr/7',
    );
    expect(pullRequestReview(fork, 'gitlab', 'acme', 'upstream')).toEqual({
      refspecs: [
        '+refs/merge-requests/7/head:refs/remotes/upstream/mr/7',
        '+refs/heads/main:refs/remotes/upstream/main',
      ],
      headRef: 'refs/remotes/upstream/mr/7',
      baseRef: 'refs/remotes/upstream/main',
    });
  });

  it('không lấy về được thì null: Bitbucket từ fork, hoặc tên nhánh do máy chủ trả về không hợp lệ', () => {
    expect(pullRequestReview(pr({ headOwner: 'someone' }), 'bitbucket', 'acme', 'origin')).toBeNull();
    for (const bad of ['', '-x', 'a:b', 'a b', 'x..y', 'a^b', 'a\\b']) {
      expect(pullRequestReview(pr({ targetBranch: bad }), 'github', 'acme', 'origin')).toBeNull();
      if (bad !== '') {
        expect(pullRequestReview(pr({ sourceBranch: bad }), 'github', 'acme', 'origin')).toBeNull();
      }
    }
    // Empty source branch (the host doesn't tell us): treat it as a forked PR and fetch via the PR ref.
    expect(pullRequestReview(pr({ sourceBranch: '' }), 'github', 'acme', 'origin')?.headRef).toBe(
      'refs/remotes/origin/pr/42',
    );
    // A forked PR's odd source branch name never reaches the refspec, so it isn't rejected.
    expect(
      pullRequestReview(
        pr({ number: '7', headOwner: 'someone', sourceBranch: 'a:b' }),
        'github',
        'acme',
        'origin',
      ),
    ).not.toBeNull();
  });

  it('nhãn trạng thái: đã merge, đã đóng, nháp; PR đang mở thì để trống', () => {
    expect(requestStateLabel(pr({ state: 'merged' }))).toBe(vi.pullRequests.merged);
    expect(requestStateLabel(pr({ state: 'closed' }))).toBe(vi.pullRequests.closed);
    expect(requestStateLabel(pr({ draft: true }))).toBe(vi.pullRequests.draft);
    expect(requestStateLabel(pr({}))).toBe('');
  });
});

const TARGET: RepoForgeTarget = {
  host: 'github.com',
  provider: 'github',
  owner: 'acme',
  repo: 'app',
  url: 'https://github.com/acme/app.git',
  remote: 'origin',
};

/**
 * origin (bare, local) has: main (base → main.txt, moved on AFTER `feat` branched), feat (base → edits base.txt +
 * adds feat.txt), and `refs/pull/7/head` (a forked PR) pointing at the tip of feat. The clone only has main;
 * the remote-tracking refs of main and feat are deleted so the review genuinely has to fetch them.
 */
async function openStore() {
  const bare = await mkdtemp(join(tmpdir(), 'thaigit-review-bare-'));
  cleanups.push(() => rm(bare, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  rawGit(bare, ['init', '--bare', '-q', '-b', 'main', '.']);
  const shas: { base: string; feat: string } = { base: '', feat: '' };
  const test = await openTestPort((git, root) => {
    writeFileSync(join(root, 'base.txt'), 'một\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    shas.base = git('rev-parse', 'HEAD').trim();
    git('remote', 'add', 'origin', bare);
    git('push', '-q', 'origin', 'main');
    git('checkout', '-q', '-b', 'feat');
    writeFileSync(join(root, 'base.txt'), 'một\nhai\n');
    writeFileSync(join(root, 'feat.txt'), 'f\n');
    git('add', '.');
    git('commit', '-q', '-m', 'feat');
    shas.feat = git('rev-parse', 'HEAD').trim();
    git('push', '-q', 'origin', 'feat');
    git('checkout', '-q', 'main');
    writeFileSync(join(root, 'main.txt'), 'm\n');
    git('add', '.');
    git('commit', '-q', '-m', 'main đi tiếp');
    git('push', '-q', 'origin', 'main');
    git('branch', '-q', '-D', 'feat');
    git('update-ref', '-d', 'refs/remotes/origin/feat');
    git('update-ref', '-d', 'refs/remotes/origin/main');
    rawGit(bare, ['update-ref', 'refs/pull/7/head', shas.feat]);
  });
  cleanups.push(() => test.cleanup());
  const toasts = new ToastStore();
  const store = new RepoStore(test.port, {
    prefs: new PrefsStore(null),
    toasts,
    detailsDelayMs: 0,
    clipboard: async () => {},
  });
  cleanups.push(() => store.dispose());
  await store.start();
  await until(() => store.hasLoaded, 'nạp xong');
  return { test, store, toasts, shas };
}

describe('openReview (git thật, remote cục bộ)', () => {
  it('lấy nhánh PR + nhánh đích về, liệt kê file so với điểm tách (không lẫn thay đổi mới của nhánh đích)', async () => {
    const { store, shas } = await openStore();
    expect(store.findRef('refs/remotes/origin/feat')).toBeUndefined();

    await openReview(store, pr({}), TARGET);
    const review = store.review;
    expect(review.isOpen).toBe(true);
    expect(review.phase).toBe('ready');
    expect(review.changes?.head).toBe(shas.feat);
    expect(review.changes?.from).toBe(shas.base);
    expect(review.changes?.files.map((file) => `${file.kind}:${file.path}`)).toEqual([
      'modified:base.txt',
      'added:feat.txt',
    ]);
    // Newly fetched refs show up in the sidebar / graph.
    await until(() => store.findRef('refs/remotes/origin/feat') !== undefined, 'refs làm mới sau fetch');
  });

  it('PR từ fork lấy qua refs/pull/<số>/head', async () => {
    const { store, shas } = await openStore();
    await openReview(store, pr({ number: '7', headOwner: 'someone', sourceBranch: 'whatever' }), TARGET);
    expect(store.review.phase).toBe('ready');
    expect(store.review.changes?.head).toBe(shas.feat);
    expect(store.review.changes?.files.map((file) => file.path)).toEqual(['base.txt', 'feat.txt']);
  });

  it('bấm file mở diff của riêng file đó (so với điểm tách), tô hàng; đóng panel thì đóng diff', async () => {
    const { store, shas } = await openStore();
    await openReview(store, pr({}), TARGET);
    const file = store.review.changes?.files.find((change) => change.path === 'feat.txt');
    expect(file).toBeDefined();
    store.review.openFile(file!, '#42');
    expect(store.diff.file?.source).toEqual({
      kind: 'commit',
      sha: shas.feat,
      parent: shas.base,
      label: '#42',
    });
    expect(store.review.openPath).toBe('feat.txt');
    await until(() => store.diff.state.kind === 'text', 'nạp diff');

    store.review.close();
    expect(store.review.isOpen).toBe(false);
    expect(store.diff.file).toBeNull();
  });

  it('đóng review khi chọn commit khác, mở Dòng thời gian hoặc Lịch sử file (cùng chỗ bên phải)', async () => {
    const { store } = await openStore();
    for (const leave of [
      () => store.select({ kind: 'none' }),
      () => store.timeline.open(),
      () => store.fileHistory.open('base.txt'),
    ]) {
      await openReview(store, pr({}), TARGET);
      expect(store.review.isOpen).toBe(true);
      leave();
      expect(store.review.isOpen).toBe(false);
      store.timeline.close();
      store.fileHistory.close();
    }
    // Conversely: opening the review closes File history.
    store.fileHistory.open('base.txt');
    await openReview(store, pr({}), TARGET);
    expect(store.fileHistory.isOpen).toBe(false);
    expect(store.review.isOpen).toBe(true);
  });

  it('nhánh đích không có trên remote: panel báo thất bại để thử lại, toast câu thân thiện (không lộ stderr git)', async () => {
    const { store, toasts } = await openStore();
    await openReview(store, pr({ targetBranch: 'khong-co' }), TARGET);
    expect(store.review.isOpen).toBe(true);
    expect(store.review.phase).toBe('failed');
    expect(store.review.changes).toBeNull();
    const shown = toasts.items.map((item) => `${item.title} ${item.message ?? ''}`).join('\n');
    expect(shown).not.toMatch(/fatal|couldn't find remote ref|refspec/i);

    // Retrying with a valid PR heals it.
    await openReview(store, pr({}), TARGET);
    expect(store.review.phase).toBe('ready');
  });

  it('kết quả của lần mở cũ về muộn không đè lần mở mới', async () => {
    const { store, shas } = await openStore();
    const first = store.review.begin(pr({ number: '1' }), 'github');
    const second = store.review.begin(pr({ number: '2' }), 'github');
    store.review.finish(first, { head: 'x', from: 'y', files: [] });
    expect(store.review.phase).toBe('loading');
    store.review.finish(second, { head: shas.feat, from: shas.base, files: [] });
    expect(store.review.phase).toBe('ready');
    expect(store.review.request?.number).toBe('2');
    store.review.close();
    store.review.fail(second);
    expect(store.review.isOpen).toBe(false);
  });

  it('người có thể gán: nạp một lần, bỏ kết quả cũ, chỉ lưu cho đúng PR đang xem, quên khi đổi / đóng PR', async () => {
    const { store } = await openStore();
    const review = store.review;
    const an = { username: 'an', name: '', id: null };
    expect(review.beginPeople()).toBeNull(); // no PR open

    const first = review.begin(pr({ number: '1' }), 'github');
    review.finish(first, { head: 'x', from: 'y', files: [] });
    const token = review.beginPeople();
    expect(token).not.toBeNull();
    expect(review.peoplePhase).toBe('loading');
    expect(review.beginPeople()).toBeNull(); // already loading: never stacked
    review.finishPeople(token!, [an]);
    expect(review.peoplePhase).toBe('ready');
    expect(review.candidates).toEqual([an]);
    expect(review.beginPeople()).toBeNull(); // already loaded: reused

    // Reloading the same PR keeps the list; switching PRs forgets it.
    review.begin(pr({ number: '1' }), 'github');
    expect(review.peoplePhase).toBe('ready');
    const other = review.begin(pr({ number: '2' }), 'github');
    review.finish(other, { head: 'x', from: 'y', files: [] });
    expect(review.peoplePhase).toBe('idle');
    expect(review.candidates).toEqual([]);

    // A late load result from the old PR is discarded; a failed load offers a retry.
    const stale = review.beginPeople()!;
    review.begin(pr({ number: '3' }), 'github');
    review.finishPeople(stale, [an]);
    expect(review.candidates).toEqual([]);
    const failing = review.beginPeople()!;
    review.failPeople(failing);
    expect(review.peoplePhase).toBe('failed');
    expect(review.beginPeople()).not.toBeNull();

    // On save: never submitted twice; the result is only accepted while the same PR is still on screen.
    expect(review.beginSaving()).toBe(true);
    expect(review.beginSaving()).toBe(false);
    review.finishSaving(pr({ number: '9', reviewers: [an] }));
    expect(review.saving).toBe(false);
    expect(review.request?.number).toBe('3');
    expect(review.peopleVersion).toBe(0);
    expect(review.beginSaving()).toBe(true);
    review.finishSaving(pr({ number: '3', reviewers: [an] }));
    expect(review.request?.reviewers).toEqual([an]);
    expect(review.peopleVersion).toBe(1);
    expect(review.beginSaving()).toBe(true);
    review.failSaving();
    expect(review.saving).toBe(false);

    review.close();
    expect(review.beginSaving()).toBe(false);
    expect(review.peoplePhase).toBe('idle');
  });
});
