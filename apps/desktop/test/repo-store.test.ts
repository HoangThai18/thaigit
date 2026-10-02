import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecRequest, ExecResult } from '@thaigit/core';
import type { RepoPort } from '../src/lib/platform/host.ts';
import { COMMIT_LIMIT_MAX, PrefsStore } from '../src/lib/stores/prefs.svelte.ts';
import { RepoStore, Scope, makeFingerprint, sameSelection } from '../src/lib/stores/repo.svelte.ts';
import { ToastStore } from '../src/lib/stores/toasts.svelte.ts';
import { fastImportLinear, openTestPort, type TestPort } from './helpers/node-port.ts';

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

/** Như `openStore` nhưng dùng chung một `ToastStore` do test cấp (nhiều repo cùng hiện toast). */
async function openStoreWith(
  toasts: ToastStore,
  setup: Parameters<typeof openTestPort>[0],
  commitLimit?: number,
): Promise<{ test: TestPort; store: RepoStore }> {
  const test = await openTestPort(setup);
  cleanups.push(() => test.cleanup());
  const prefs = new PrefsStore(null);
  if (commitLimit !== undefined) prefs.update({ commitLimit });
  const store = new RepoStore(test.port, { prefs, toasts, detailsDelayMs: 0, clipboard: async () => {} });
  cleanups.push(() => store.dispose());
  return { test, store };
}

async function openStore(
  setup: Parameters<typeof openTestPort>[0],
  options: { commitLimit?: number } = {},
): Promise<{ test: TestPort; store: RepoStore; toasts: ToastStore; prefs: PrefsStore }> {
  const test = await openTestPort(setup);
  cleanups.push(() => test.cleanup());
  const prefs = new PrefsStore(null);
  if (options.commitLimit !== undefined) prefs.update({ commitLimit: options.commitLimit });
  const toasts = new ToastStore();
  const store = new RepoStore(test.port, { prefs, toasts, detailsDelayMs: 0, clipboard: async () => {} });
  cleanups.push(() => store.dispose());
  return { test, store, toasts, prefs };
}

/** Bọc `exec` của port để chèn lỗi / ghi lại lệnh (các test lỗi hạ tầng). `inner` chạy lệnh thật. */
function withExec(
  port: RepoPort,
  wrap: (request: ExecRequest, inner: (request: ExecRequest) => Promise<ExecResult>) => Promise<ExecResult>,
  info: Partial<RepoPort['info']> = {},
): RepoPort {
  return {
    ...port,
    info: { ...port.info, ...info },
    exec: { run: (request) => wrap(request, (next) => port.exec.run(next)) },
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** main: A ← B ← M (merge feature/x) ; feature/x: A ← F ; tag v1.0 trên B ; một stash. */
function setupBranchy(git: (...args: string[]) => string, root: string): void {
  writeFileSync(join(root, 'a.txt'), 'một\n');
  git('add', '.');
  git('commit', '-q', '-m', 'Khởi tạo');
  git('switch', '-q', '-c', 'feature/x');
  writeFileSync(join(root, 'f.txt'), 'f\n');
  git('add', '.');
  git('commit', '-q', '-m', 'Làm tính năng x');
  git('switch', '-q', 'main');
  writeFileSync(join(root, 'a.txt'), 'một\nhai\n');
  git('commit', '-q', '-a', '-m', 'Sửa a');
  git('tag', 'v1.0');
  git('merge', '-q', '--no-ff', '-m', "Merge branch 'feature/x'", 'feature/x');
  writeFileSync(join(root, 'a.txt'), 'một\nhai\nba\n');
  git('stash', 'push', '-q', '-m', 'Đang thử');
}

describe('makeFingerprint / sameSelection', () => {
  const refs = [
    { fullName: 'refs/heads/main', target: 'a' },
    { fullName: 'refs/tags/v1', target: 'b' },
  ];
  const options = { showRemotes: true, showTags: true, order: 'date' };

  it('đổi ref, HEAD hoặc tuỳ chọn hiển thị thì đổi; giữ nguyên thì không', () => {
    const head = { kind: 'branch', name: 'main', oid: 'a' } as const;
    const base = makeFingerprint(refs, head, options);
    expect(makeFingerprint([...refs], { ...head }, { ...options })).toBe(base);
    expect(makeFingerprint([{ ...refs[0]!, target: 'c' }, refs[1]!], head, options)).not.toBe(base);
    expect(makeFingerprint(refs, { kind: 'detached', oid: 'a' }, options)).not.toBe(base);
    expect(makeFingerprint(refs, head, { ...options, showTags: false })).not.toBe(base);
    expect(makeFingerprint(refs, head, { ...options, order: 'topo' })).not.toBe(base);
  });

  it('chọn: cùng loại và cùng sha mới là một', () => {
    expect(sameSelection({ kind: 'none' }, { kind: 'none' })).toBe(true);
    expect(sameSelection({ kind: 'commit', sha: 'a' }, { kind: 'commit', sha: 'a' })).toBe(true);
    expect(sameSelection({ kind: 'commit', sha: 'a' }, { kind: 'commit', sha: 'b' })).toBe(false);
    expect(sameSelection({ kind: 'commit', sha: 'a' }, { kind: 'stash', sha: 'a' })).toBe(false);
  });
});

describe('RepoStore: nạp lần đầu', () => {
  it('nạp refs, stash, remote và lịch sử; sắp xếp danh sách; chọn HEAD (repo có WIP thì chọn WIP trước)', async () => {
    const { store } = await openStore(setupBranchy);
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');

    expect(store.currentBranch).toBe('main');
    expect(store.localBranches.map((ref) => ref.fullName)).toEqual([
      'refs/heads/feature/x',
      'refs/heads/main',
    ]);
    expect(store.tags.map((ref) => ref.fullName)).toEqual(['refs/tags/v1.0']);
    expect(store.stashes.map((stash) => stash.message)).toEqual(['On main: Đang thử']);
    expect(store.remotes).toEqual([]);
    expect(store.historyError).toBeNull();

    // a.txt đã sửa chưa commit sau stash? Stash đã cất → sạch → không có WIP.
    expect(store.hasWorkingTreeRow).toBe(false);
    expect(store.entries.map((entry) => entry.commit.subject)).toEqual([
      "Merge branch 'feature/x'",
      'Sửa a',
      'Làm tính năng x',
      'Khởi tạo',
    ]);
    expect(store.selection).toEqual({ kind: 'commit', sha: store.headOid });
    expect(store.selectedRow).toBe(0);
    expect(store.scrollRequest?.row).toBe(0);
    expect(store.graphLanes).toBeGreaterThanOrEqual(2);

    const head = store.entries[0]!;
    expect(head.labels.map((label) => label.text)).toEqual(['main']);
    const tagged = store.entries.find((entry) => entry.commit.subject === 'Sửa a')!;
    expect(tagged.labels.map((label) => label.text)).toEqual(['v1.0']);
    expect(store.branchSubtitle).toBe('main');
  });

  it('chi tiết commit được nạp (message + file thay đổi), chi tiết stash cũng vậy', async () => {
    const { store } = await openStore(setupBranchy);
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    await until(() => store.details?.commit.id === store.headOid, 'chi tiết HEAD');
    expect(store.details?.message.trim()).toBe("Merge branch 'feature/x'");
    expect(store.details?.files.map((file) => file.path)).toEqual(['f.txt']);

    const stash = store.stashes[0]!;
    store.select({ kind: 'stash', sha: stash.sha });
    await until(() => store.details?.commit.id === stash.sha, 'chi tiết stash');
    expect(store.details?.files.map((file) => file.path)).toEqual(['a.txt']);
    expect(store.details?.commit.subject).toBe('WIP trên main: Đang thử'.replace('WIP trên main: ', ''));
    expect(store.isLoadingDetails).toBe(false);

    store.select({ kind: 'none' });
    expect(store.details).toBeNull();
  });

  it('repo đang sửa dở: dòng WIP ở hàng 0, được chọn đầu tiên và không có chi tiết commit', async () => {
    const { store } = await openStore((git, root) => {
      writeFileSync(join(root, 'a.txt'), 'x\n');
      git('add', '.');
      git('commit', '-q', '-m', 'Khởi tạo');
      writeFileSync(join(root, 'a.txt'), 'y\n');
      writeFileSync(join(root, 'new.txt'), 'mới\n');
    });
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    expect(store.hasWorkingTreeRow).toBe(true);
    expect(store.entries[0]?.commit.parents).toEqual([store.headOid]);
    expect(store.selection).toEqual({ kind: 'workingTree' });
    expect(store.selectedRow).toBe(0);
    expect(store.details).toBeNull();
    expect(store.status.unstaged.map((change) => change.path).sort()).toEqual(['a.txt', 'new.txt']);
  });

  it('repo trống (chưa có commit): graph rỗng, không lỗi', async () => {
    const { store, toasts } = await openStore(() => {});
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    expect(store.entries).toEqual([]);
    expect(store.historyError).toBeNull();
    expect(store.selection).toEqual({ kind: 'none' });
    expect(toasts.items).toEqual([]);
  });

  it('HEAD chưa có commit nhưng repo có nhánh khác (orphan): vẫn thấy lịch sử của nhánh kia', async () => {
    const { store } = await openStore((git, root) => {
      writeFileSync(join(root, 'a.txt'), 'x\n');
      git('add', '.');
      git('commit', '-q', '-m', 'Khởi tạo');
      git('checkout', '-q', '--orphan', 'mo-coi');
      git('rm', '-q', '-rf', '.');
    });
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    expect(store.entries.map((entry) => entry.commit.subject)).toEqual(['Khởi tạo']);
  });
});

describe('RepoStore: làm mới theo sự kiện', () => {
  it('sự kiện workingTree chỉ nạp lại status và dựng WIP (không chạy lại git log, không đọc lại refs)', async () => {
    const { test, store } = await openStore(setupBranchy);
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    const log = vi.spyOn(store.git, 'logBytes');
    const refs = vi.spyOn(store.git, 'refs');
    const status = vi.spyOn(store.git, 'status');

    await test.write('moi.txt', 'chưa track\n');
    test.emit({ kinds: ['workingTree'] });
    await until(() => store.hasWorkingTreeRow, 'WIP hiện ra');

    expect(status).toHaveBeenCalledTimes(1);
    expect(refs).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(store.entries[0]?.commit.parents).toEqual([store.headOid]);
    expect(store.entries).toHaveLength(5);
    // Lựa chọn commit HEAD vẫn giữ nguyên (hàng dịch xuống 1).
    expect(store.selection).toEqual({ kind: 'commit', sha: store.headOid });
    expect(store.selectedRow).toBe(1);
  });

  it('sự kiện refs: commit mới → dấu vân tay đổi → nạp lại lịch sử và nhãn', async () => {
    const { test, store } = await openStore(setupBranchy);
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    const before = store.graphVersion;
    const log = vi.spyOn(store.git, 'logBytes');

    test.git('commit', '-q', '--allow-empty', '-m', 'Thêm từ terminal');
    test.emit({ kinds: ['refs', 'workingTree'] });
    await until(() => store.entries[0]?.commit.subject === 'Thêm từ terminal', 'commit mới hiện ra');
    expect(log).toHaveBeenCalledTimes(1);
    expect(store.graphVersion).toBeGreaterThan(before);
    expect(store.entries[0]?.labels.map((label) => label.text)).toEqual(['main']);
    expect(store.entries[1]?.labels).toEqual([]);
  });

  it('đổi upstream (không đổi commit): cập nhật nhãn mà không nạp lại lịch sử', async () => {
    const { test, store } = await openStore(setupBranchy);
    test.git('remote', 'add', 'origin', test.root);
    test.git('update-ref', 'refs/remotes/origin/main', test.git('rev-parse', 'main').trim());
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    expect(store.entries[0]?.labels[0]).toMatchObject({ text: 'main', remoteCount: 1 });

    const log = vi.spyOn(store.git, 'logBytes');
    test.git('branch', '--set-upstream-to=origin/main', 'main');
    test.emit({ kinds: ['refs'] });
    await until(
      () => store.localBranches.find((ref) => ref.fullName === 'refs/heads/main')?.upstream === 'origin/main',
      'upstream mới',
    );
    expect(log).not.toHaveBeenCalled();
    expect(store.entries[0]?.labels[0]).toMatchObject({ text: 'main', remoteCount: 1 });
  });

  it('nhiều sự kiện dồn dập được gộp (không chạy chồng), kết quả cuối đúng', async () => {
    const { test, store } = await openStore(setupBranchy);
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    const status = vi.spyOn(store.git, 'status');

    await test.write('n1.txt', '1\n');
    for (let index = 0; index < 20; index++) test.emit({ kinds: ['workingTree'] });
    await until(() => store.status.unstaged.some((change) => change.path === 'n1.txt'), 'thấy file mới');
    await store.refreshAndWait(0);
    // Lượt đầu + tối đa một lượt gộp phần còn lại.
    expect(status.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('sau dispose: dừng watcher và bỏ qua sự kiện', async () => {
    const { test, store } = await openStore(setupBranchy);
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    expect(test.watchers.count).toBe(1);
    await store.dispose();
    expect(test.watchers.stopped).toBe(1);
    const status = vi.spyOn(store.git, 'status');
    test.emit({ kinds: ['workingTree'] });
    store.handleChange({ repoId: 'test', kinds: ['workingTree'] });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(status).not.toHaveBeenCalled();
  });

  it('phạm vi của từng loại sự kiện', async () => {
    const { test, store } = await openStore(setupBranchy);
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    const request = vi.spyOn(store, 'requestRefresh');
    test.emit({ kinds: ['workingTree'] });
    test.emit({ kinds: ['refs'] });
    test.emit({ kinds: ['rescan'] });
    test.emit({ kinds: [] });
    expect(request.mock.calls.map(([scope]) => scope)).toEqual([
      Scope.status,
      Scope.refs | Scope.status,
      Scope.all,
    ]);
  });
});

describe('RepoStore: tải thêm lịch sử', () => {
  it('mayHaveMore khi chạm giới hạn; loadMoreHistory nới giới hạn và nạp đủ', async () => {
    const { store } = await openStore((git, root) => fastImportLinear(git, root, 450), { commitLimit: 200 });
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    expect(store.entries).toHaveLength(200);
    expect(store.mayHaveMoreCommits).toBe(true);
    expect(store.entries[0]?.commit.subject).toBe('Sửa lỗi số 450');

    store.loadMoreHistory();
    expect(store.isLoadingHistory).toBe(true);
    store.loadMoreHistory(); // gọi lặp khi đang tải: bị bỏ qua
    await until(() => !store.isLoadingHistory, 'tải thêm xong');
    expect(store.commitLimit).toBe(2200);
    expect(store.entries).toHaveLength(450);
    expect(store.mayHaveMoreCommits).toBe(false);
    expect(store.entries[449]?.commit.subject).toBe('Sửa lỗi số 1');
  });

  it('reveal commit ngoài phần đã tải: báo kèm nút "Tải thêm"', async () => {
    const { store, toasts } = await openStore((git, root) => fastImportLinear(git, root, 300), {
      commitLimit: 200,
    });
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    store.reveal('f'.repeat(40));
    expect(toasts.items).toHaveLength(1);
    expect(toasts.items[0]?.actions.map((action) => action.title)).toEqual(['Tải thêm']);
    toasts.items[0]?.actions[0]?.run();
    await until(() => store.entries.length === 300, 'đã tải thêm');
  });
});

describe('RepoStore: tải thêm lịch sử bị lỗi', () => {
  async function openFlaky(count: number, commitLimit: number) {
    const test = await openTestPort((git, root) => fastImportLinear(git, root, count));
    cleanups.push(() => test.cleanup());
    const flaky = { failLog: false, limits: [] as string[] };
    const port = withExec(test.port, (request, inner) => {
      if (request.sub === 'log') {
        flaky.limits.push(request.args.find((arg) => arg.startsWith('--max-count=')) ?? '(không giới hạn)');
        if (flaky.failLog) return Promise.reject(new Error('giả lập: git log thất bại'));
      }
      return inner(request);
    });
    const prefs = new PrefsStore(null);
    prefs.update({ commitLimit });
    const toasts = new ToastStore();
    const store = new RepoStore(port, { prefs, toasts, detailsDelayMs: 0 });
    cleanups.push(() => store.dispose());
    await store.start();
    await until(() => store.hasLoaded && !store.isLoadingHistory, 'nạp xong');
    return { store, toasts, flaky };
  }

  it('lỗi: trả commitLimit về cũ, đặt loadMoreFailed và dừng tải thêm tự động; chỉ người dùng mới thử lại được', async () => {
    const { store, toasts, flaky } = await openFlaky(450, 200);
    expect(store.entries).toHaveLength(200);
    flaky.failLog = true;
    store.loadMoreHistory();
    await until(() => !store.isLoadingHistory, 'lần tải thêm hỏng xong');

    expect(store.commitLimit).toBe(200);
    expect(store.loadMoreFailed).toBe(true);
    expect(store.entries).toHaveLength(200);
    expect(store.mayHaveMoreCommits).toBe(true);
    const errors = toasts.items.filter((toast) => toast.style === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.actions.map((action) => action.title)).toEqual(['Tải thêm']);

    // Tự động (cuộn tới cuối) gọi lại bao nhiêu lần cũng không chạy thêm lệnh git nào.
    const before = flaky.limits.length;
    for (let index = 0; index < 20; index++) store.loadMoreHistory();
    await sleep(60);
    expect(flaky.limits).toHaveLength(before);
    expect(store.isLoadingHistory).toBe(false);

    // Người dùng bấm "Tải thêm" trên thông báo: thử lại thật, thành công thì cờ được xoá.
    flaky.failLog = false;
    errors[0]?.actions[0]?.run();
    await until(() => store.entries.length === 450, 'thử lại thành công');
    expect(store.loadMoreFailed).toBe(false);
    expect(store.commitLimit).toBe(2200);
  });

  it('thử lại do người dùng mà vẫn lỗi: giữ nguyên giới hạn cũ, cờ lỗi bật lại', async () => {
    const { store, flaky } = await openFlaky(450, 200);
    flaky.failLog = true;
    store.loadMoreHistory();
    await until(() => store.loadMoreFailed, 'lỗi lần đầu');
    store.loadMoreHistory(true);
    expect(store.isLoadingHistory).toBe(true);
    await until(() => !store.isLoadingHistory, 'lần thử lại xong');
    expect(store.loadMoreFailed).toBe(true);
    expect(store.commitLimit).toBe(200);
    expect(flaky.limits.filter((limit) => limit === '--max-count=2200')).toHaveLength(2);
  });

  it('commitLimit không bao giờ vượt COMMIT_LIMIT_MAX (không còn --max-count=Infinity)', async () => {
    const { store, flaky } = await openFlaky(450, 200);
    store.commitLimit = COMMIT_LIMIT_MAX - 10;
    store.mayHaveMoreCommits = true;
    store.loadMoreHistory();
    await until(() => !store.isLoadingHistory, 'tải tới trần');
    expect(store.commitLimit).toBe(COMMIT_LIMIT_MAX);
    expect(flaky.limits.at(-1)).toBe(`--max-count=${COMMIT_LIMIT_MAX}`);

    // Đã chạm trần: không chạy thêm lệnh nào dù cờ "còn commit" vẫn bật, và không có nút "Tải thêm" vô dụng.
    const before = flaky.limits.length;
    store.mayHaveMoreCommits = true;
    expect(store.canLoadMore).toBe(false);
    for (let index = 0; index < 10; index++) store.loadMoreHistory(true);
    await sleep(60);
    expect(flaky.limits).toHaveLength(before);
    expect(store.commitLimit).toBe(COMMIT_LIMIT_MAX);
    expect(Number.isFinite(store.commitLimit)).toBe(true);
  });
});

describe('RepoStore: toast của repo đã đóng và lỗi trùng', () => {
  const untrusted = (): Error => Object.assign(new Error('repo chưa được tin tưởng'), { code: 'untrusted' });
  const notFound = (): Error => Object.assign(new Error('không thấy thư mục'), { code: 'not-found' });

  async function openWith(
    toasts: ToastStore,
    repoId: string,
    fail: ((request: ExecRequest) => Error | null) | null,
    onUntrusted?: () => void,
  ): Promise<RepoStore> {
    const test = await openTestPort((git, root) => {
      writeFileSync(join(root, 'a.txt'), 'a\n');
      git('add', 'a.txt');
      git('commit', '-qm', 'đầu tiên');
    });
    cleanups.push(() => test.cleanup());
    const port = withExec(
      test.port,
      (request, inner) => {
        const error = fail?.(request) ?? null;
        return error ? Promise.reject(error) : inner(request);
      },
      { repoId },
    );
    const store = new RepoStore(port, {
      prefs: new PrefsStore(null),
      toasts,
      detailsDelayMs: 0,
      onUntrusted,
    });
    cleanups.push(() => store.dispose());
    return store;
  }

  it('dispose gỡ toast của chính store đó (kể cả nút bấm), không đụng toast của repo khác hay của ứng dụng', async () => {
    const toasts = new ToastStore();
    const reviewA = vi.fn();
    const reviewB = vi.fn();
    const storeA = await openWith(toasts, 'repo-a', () => untrusted(), reviewA);
    await storeA.start();
    await until(() => toasts.items.some((toast) => toast.style === 'warning'), 'cảnh báo của A');
    const staleToast = toasts.items.find((toast) => toast.style === 'warning')!;
    const storeB = await openWith(toasts, 'repo-b', () => untrusted(), reviewB);
    await storeB.start();
    await until(
      () => toasts.items.filter((toast) => toast.style === 'warning').length === 2,
      'cảnh báo của B',
    );
    toasts.info('của ứng dụng');

    await storeA.dispose();
    expect(toasts.items.map((toast) => toast.title)).toEqual([
      'Cấu hình repo vừa thay đổi — Thaigit tạm dừng chạy lệnh cho tới khi bạn xem lại.',
      'của ứng dụng',
    ]);
    expect(toasts.items.some((toast) => toast.id === staleToast.id)).toBe(false);
    toasts.items[0]?.actions[0]?.run();
    expect(reviewB).toHaveBeenCalledOnce();
    expect(reviewA).not.toHaveBeenCalled();
  });

  it('toast "Tải thêm" của repo đã đóng cũng bị gỡ; đóng rồi thì store không đẩy thêm toast nào', async () => {
    const toasts = new ToastStore();
    const { store } = await openStoreWith(toasts, (git, root) => fastImportLinear(git, root, 300), 200);
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    store.reveal('f'.repeat(40));
    expect(toasts.items).toHaveLength(1);
    await store.dispose();
    expect(toasts.items).toEqual([]);
    store.reveal('f'.repeat(40));
    await store.copy('x', 'SHA');
    expect(toasts.items).toEqual([]);
  });

  it('lỗi làm mới của hai repo không đè / xoá nhầm nhau (mỗi repo một tag)', async () => {
    const toasts = new ToastStore();
    const broken = await openWith(toasts, 'repo-hong', () => untrusted());
    await broken.start();
    await until(() => toasts.items.length > 0, 'cảnh báo của repo hỏng');
    const healthy = await openWith(toasts, 'repo-tot', null);
    await healthy.start();
    await until(() => healthy.hasLoaded, 'repo tốt nạp xong');
    await healthy.refreshAndWait(Scope.status);
    expect(toasts.items.filter((toast) => toast.style === 'warning')).toHaveLength(1);
  });

  it('mọi lệnh bị từ chối `untrusted` (status, refs, lịch sử): đúng MỘT cảnh báo, không kèm lỗi git thô', async () => {
    const toasts = new ToastStore();
    const store = await openWith(toasts, 'repo-u', () => untrusted(), vi.fn());
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    expect(toasts.items.map((toast) => toast.style)).toEqual(['warning']);
    expect(store.historyError).toBe('repo chưa được tin tưởng');
  });

  it('mọi lệnh báo `not-found` (thư mục repo mất): đúng MỘT thông báo "không tìm thấy thư mục"', async () => {
    const toasts = new ToastStore();
    const store = await openWith(toasts, 'repo-m', () => notFound());
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    expect(toasts.items.map((toast) => toast.title)).toEqual(['Không tìm thấy thư mục repository']);
  });

  it('chi tiết commit bị từ chối `untrusted`: dùng chung cảnh báo (không thêm lỗi git thô); lỗi thường vẫn hiện nguyên văn', async () => {
    const toasts = new ToastStore();
    let mode: 'untrusted' | 'io' = 'untrusted';
    const store = await openWith(toasts, 'repo-d', (request) =>
      request.sub === 'diff-tree' ? (mode === 'untrusted' ? untrusted() : new Error('đĩa lỗi')) : null,
    );
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    await until(() => toasts.items.length === 1, 'cảnh báo chi tiết');
    expect(toasts.items.map((toast) => toast.style)).toEqual(['warning']);

    mode = 'io';
    store.select({ kind: 'none' });
    store.select({ kind: 'commit', sha: store.headOid! });
    await until(() => toasts.items.some((toast) => toast.style === 'error'), 'lỗi thường');
    expect(toasts.items.find((toast) => toast.style === 'error')).toMatchObject({
      title: 'Không tải được chi tiết commit',
      message: 'đĩa lỗi',
    });
  });
});

describe('RepoStore: hàng đợi thao tác', () => {
  it('chạy tuần tự theo thứ tự gọi, làm mới sau mỗi thao tác, lỗi hiện toast và không chặn thao tác sau', async () => {
    const { store, toasts } = await openStore(setupBranchy);
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    const order: string[] = [];
    const status = vi.spyOn(store.git, 'status');

    const first = store.perform('Thao tác 1', async () => {
      order.push('1 bắt đầu');
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push('1 xong');
    });
    const second = store.perform('Thao tác 2', async () => {
      order.push('2 bắt đầu');
      throw new Error('hỏng rồi');
    });
    const third = store.perform(
      'Thao tác 3',
      async () => {
        order.push('3');
      },
      { refresh: Scope.status },
    );
    await Promise.all([first, second, third]);

    expect(order).toEqual(['1 bắt đầu', '1 xong', '2 bắt đầu', '3']);
    expect(toasts.items.map((toast) => [toast.style, toast.title, toast.message])).toEqual([
      ['error', 'Thao tác 2', 'hỏng rồi'],
    ]);
    expect(status.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(store.busy).toBeNull();
  });

  it('làm mới sau thao tác mặc định chỉ nạp status + refs; lịch sử nạp lại khi (và chỉ khi) ref đổi', async () => {
    const { test, store } = await openStore(setupBranchy);
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    const log = vi.spyOn(store.git, 'logBytes');
    const refs = vi.spyOn(store.git, 'refs');

    await store.perform('Không đổi gì', async () => {});
    expect(refs).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();

    await store.perform('Commit', async () => {
      test.git('commit', '-q', '--allow-empty', '-m', 'Do thao tác');
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(store.entries[0]?.commit.subject).toBe('Do thao tác');
  });

  it('sự kiện file trong lúc đang chạy thao tác được dồn vào lần làm mới sau thao tác', async () => {
    const { test, store } = await openStore(setupBranchy);
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    const status = vi.spyOn(store.git, 'status');
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));

    const running = store.perform(
      'Chậm',
      async () => {
        await gate;
      },
      { refresh: 0 },
    );
    test.emit({ kinds: ['workingTree'] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(status).not.toHaveBeenCalled();
    release();
    await running;
    expect(status).toHaveBeenCalledTimes(1);
  });

  it('thao tác có tiến trình đặt/xoá `busy`; huỷ bằng AbortSignal báo "Đã huỷ"', async () => {
    const { store, toasts } = await openStore(setupBranchy);
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    let started: () => void = () => {};
    const hasStarted = new Promise<void>((resolve) => (started = resolve));

    const running = store.perform(
      'Fetch',
      (_git, signal) =>
        new Promise<void>((_resolve, reject) => {
          started();
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      { showsProgress: true, cancellable: true, refresh: 0 },
    );
    await hasStarted;
    expect(store.busy).toMatchObject({ title: 'Fetch', canCancel: true });
    store.cancelCurrentOperation();
    await running;
    expect(store.busy).toBeNull();
    expect(toasts.items.map((toast) => toast.title)).toEqual(['Đã huỷ: Fetch']);
  });
});

describe('RepoStore — lõi Rust từ chối vì repo chưa được tin tưởng', () => {
  it('lỗi `untrusted` khi làm mới → một cảnh báo có nút "Xem lại cấu hình repo" gọi onUntrusted', async () => {
    const test = await openTestPort((git, root) => {
      writeFileSync(join(root, 'a.txt'), 'a\n');
      git('add', 'a.txt');
      git('commit', '-qm', 'đầu tiên');
    });
    cleanups.push(() => test.cleanup());
    const inner = test.port;
    // Như repo có `include` trỏ vào file trong repo: lõi Rust chặn status/diff tới khi người dùng tin tưởng lại.
    const port: RepoPort = {
      info: inner.info,
      fs: inner.fs,
      typedGit: inner.typedGit,
      watch: (onChange) => inner.watch(onChange),
      trust: () => inner.trust(),
      exec: {
        run: async (request) => {
          if (request.sub === 'status') throw { code: 'untrusted', message: 'repo chưa được tin tưởng' };
          return inner.exec.run(request);
        },
      },
    };
    const toasts = new ToastStore();
    const onUntrusted = vi.fn();
    const store = new RepoStore(port, {
      prefs: new PrefsStore(null),
      toasts,
      detailsDelayMs: 0,
      onUntrusted,
    });
    cleanups.push(() => store.dispose());
    await store.start();
    await until(() => toasts.items.length > 0, 'có thông báo');

    expect(toasts.items).toHaveLength(1);
    const [toast] = toasts.items;
    expect(toast?.style).toBe('warning');
    expect(toast?.title).toBe(
      'Cấu hình repo vừa thay đổi — Thaigit tạm dừng chạy lệnh cho tới khi bạn xem lại.',
    );
    expect(toast?.actions.map((action) => action.title)).toEqual(['Xem lại cấu hình repo']);
    toast?.actions[0]?.run();
    expect(onUntrusted).toHaveBeenCalledOnce();
  });
});
