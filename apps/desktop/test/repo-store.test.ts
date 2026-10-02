import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepoPort } from '../src/lib/platform/host.ts';
import { PrefsStore } from '../src/lib/stores/prefs.svelte.ts';
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
