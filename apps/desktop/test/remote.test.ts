// Fetch / pull / push / tạo nhánh / đổi nhánh / stash — chạy trên repo git thật với "remote" là repo bare cục bộ.
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { shouldAutoFetch } from '../src/lib/actions/autoFetch.ts';
import { beginCreateBranch, checkout, switchToBranch } from '../src/lib/actions/branches.ts';
import { backgroundFetch, fetch, pull, push } from '../src/lib/actions/remote.ts';
import { popLatestStash, quickStash } from '../src/lib/actions/stash.ts';
import { DialogStore } from '../src/lib/stores/dialogs.svelte.ts';
import { PrefsStore } from '../src/lib/stores/prefs.svelte.ts';
import { RepoStore } from '../src/lib/stores/repo.svelte.ts';
import { ToastStore } from '../src/lib/stores/toasts.svelte.ts';
import { openTestPort, rawGit, type TestPort } from './helpers/node-port.ts';

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

interface Fixture {
  test: TestPort;
  store: RepoStore;
  toasts: ToastStore;
  dialogs: DialogStore;
  /** Repo bare đóng vai remote `origin`. */
  bare: string;
  /** Bản clone thứ hai — "đồng nghiệp" đẩy commit lên remote. */
  other: string;
}

/** Repo có `origin` (bare cục bộ) với `main` đã push và đặt upstream, cùng một bản clone khác của remote. */
async function openWithRemote(): Promise<Fixture> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'thaigit-remote-test-')));
  cleanups.push(() => rm(base, { recursive: true, force: true, maxRetries: 3 }));
  const bare = join(base, 'origin.git');
  const other = join(base, 'other');
  rawGit(base, ['init', '-q', '--bare', '-b', 'main', bare]);
  const test = await openTestPort((git, root) => {
    writeFileSync(join(root, 'a.txt'), 'một\n');
    git('add', '.');
    git('commit', '-q', '-m', 'Khởi tạo');
    git('remote', 'add', 'origin', bare);
    git('push', '-q', '-u', 'origin', 'main');
  });
  cleanups.push(() => test.cleanup());
  rawGit(base, ['clone', '-q', bare, other]);
  const toasts = new ToastStore();
  const store = new RepoStore(test.port, { prefs: new PrefsStore(null), toasts, detailsDelayMs: 0, clipboard: async () => {} });
  cleanups.push(() => store.dispose());
  await store.start();
  await until(() => store.hasLoaded && store.remotes.length === 1, 'nạp xong');
  return { test, store, toasts, dialogs: new DialogStore(), bare, other };
}

/** "Đồng nghiệp" commit và push một file lên remote. */
function pushFromOther(other: string, file: string, content: string, message: string): void {
  writeFileSync(join(other, file), content);
  rawGit(other, ['add', '.']);
  rawGit(other, ['commit', '-q', '-m', message]);
  rawGit(other, ['push', '-q', 'origin', 'main']);
}

function action(toasts: ToastStore, title: string): () => void {
  const toast = [...toasts.items].reverse().find((item) => item.actions.some((candidate) => candidate.title === title));
  const found = toast?.actions.find((candidate) => candidate.title === title);
  if (!found) throw new Error(`Không thấy nút “${title}” (toast: ${toasts.items.map((item) => item.title).join(' | ')})`);
  return found.run;
}

function lastToast(toasts: ToastStore): string {
  return toasts.items.at(-1)?.title ?? '';
}

describe('fetch / pull', () => {
  it('fetch thấy commit mới trên remote, pull kéo về và hoàn tác được', async () => {
    const { test, store, toasts, other } = await openWithRemote();
    const before = store.headOid;
    pushFromOther(other, 'b.txt', 'hai\n', 'Thêm b');

    await fetch(store);
    expect(lastToast(toasts)).toBe('Đã fetch xong');
    expect(store.status.behind).toBe(1);
    expect(store.lastFetch).not.toBeNull();
    expect(store.busy).toBeNull();

    await pull(store);
    expect(lastToast(toasts)).toBe('Đã pull về main');
    expect(store.status.behind).toBe(0);
    expect(test.git('log', '-1', '--format=%s').trim()).toBe('Thêm b');

    action(toasts, 'Hoàn tác')();
    await until(() => store.headOid === before, 'hoàn tác pull');
  });

  it('nhánh tách nhau + chỉ fast-forward: báo lỗi kèm Pull (merge) / Pull (rebase)', async () => {
    const { test, store, toasts, other } = await openWithRemote();
    pushFromOther(other, 'b.txt', 'của đồng nghiệp\n', 'Commit trên remote');
    await test.write('c.txt', 'của tôi\n');
    test.git('add', '.');
    test.git('commit', '-q', '-m', 'Commit local');
    await store.refreshAndWait(7);

    await pull(store, 'fastForwardOnly');
    expect(lastToast(toasts)).toBe('Nhánh local và remote đã tách nhau');
    action(toasts, 'Pull (rebase)')();
    await until(() => lastToast(toasts) === 'Đã pull về main', 'pull rebase');
    expect(test.git('log', '--format=%s', '-3').trim().split('\n')).toEqual([
      'Commit local',
      'Commit trên remote',
      'Khởi tạo',
    ]);
  });

  it('nhánh chưa có upstream thì không pull, gợi ý push', async () => {
    const { test, store, toasts } = await openWithRemote();
    test.git('switch', '-q', '-c', 'moi');
    await store.refreshAndWait(7);
    await pull(store);
    expect(lastToast(toasts)).toBe('Nhánh moi chưa có nhánh tương ứng trên remote');
    expect(toasts.items.at(-1)?.actions.map((item) => item.title)).toEqual(['Push lên remote']);
  });

  it('tự fetch nền: chỉ chạy khi đến hạn, lỗi chỉ hiện một cảnh báo', async () => {
    const { store, toasts, other } = await openWithRemote();
    expect(shouldAutoFetch(store, Date.now(), false)).toBe(true);
    expect(shouldAutoFetch(store, Date.now(), true)).toBe(false);
    pushFromOther(other, 'b.txt', 'hai\n', 'Thêm b');
    await backgroundFetch(store);
    expect(store.status.behind).toBe(1);
    expect(toasts.items).toHaveLength(0);
    expect(shouldAutoFetch(store, Date.now(), false)).toBe(false);
    expect(shouldAutoFetch(store, Date.now() + 11 * 60_000, false)).toBe(true);
  });
});

describe('push', () => {
  it('push lên upstream; bị từ chối thì gợi ý Pull trước / Force push', async () => {
    const { test, store, toasts, dialogs, bare, other } = await openWithRemote();
    await test.write('a.txt', 'một\nhai\n');
    test.git('commit', '-q', '-am', 'Sửa a');
    await store.refreshAndWait(7);
    expect(store.status.ahead).toBe(1);

    await push(store, { dialogs });
    expect(lastToast(toasts)).toBe('Đã push main → origin/main');
    expect(rawGit(bare, ['rev-parse', 'main']).trim()).toBe(store.headOid);

    // Đồng nghiệp push trước: push của mình bị từ chối.
    rawGit(other, ['pull', '-q']);
    pushFromOther(other, 'b.txt', 'b\n', 'Của đồng nghiệp');
    await test.write('c.txt', 'c\n');
    test.git('add', '.');
    test.git('commit', '-q', '-m', 'Của tôi');
    await store.refreshAndWait(7);
    await push(store, { dialogs });
    expect(lastToast(toasts)).toBe('Push bị từ chối — remote có commit mà máy bạn chưa có');
    expect(toasts.items.at(-1)?.actions.map((item) => item.title)).toEqual(['Pull trước', 'Force push…']);

    // Force push (with-lease cần đã fetch ref remote mới nhất).
    await fetch(store);
    const done = push(store, { force: true, dialogs });
    await done;
    expect(rawGit(bare, ['rev-parse', 'main']).trim()).toBe(store.headOid);
  });

  it('nhánh mới chưa có upstream: hỏi remote + tên nhánh rồi đặt upstream', async () => {
    const { test, store, toasts, dialogs, bare } = await openWithRemote();
    test.git('switch', '-q', '-c', 'tinh-nang');
    await store.refreshAndWait(7);

    const pushing = push(store, { dialogs });
    await until(() => dialogs.current?.kind === 'form', 'form push');
    const form = dialogs.current!;
    expect(form.kind === 'form' && form.fields.map((field) => [field.id, field.value])).toEqual([
      ['remote', 'origin'],
      ['branch', 'tinh-nang'],
    ]);
    // Tên không hợp lệ: không gửi được.
    dialogs.submit({ remote: 'origin', branch: 'tên có dấu cách' });
    expect(dialogs.current).not.toBeNull();
    dialogs.submit({ remote: 'origin', branch: 'tinh-nang' });
    await pushing;

    expect(lastToast(toasts)).toBe('Đã push tinh-nang → origin/tinh-nang');
    expect(rawGit(bare, ['rev-parse', 'tinh-nang']).trim()).toBe(store.headOid);
    expect(store.currentBranchRef?.upstream).toBe('origin/tinh-nang');
  });
});

describe('nhánh / stash từ thanh công cụ', () => {
  it('tạo nhánh qua form, đổi nhánh rồi hoàn tác', async () => {
    const { store, toasts, dialogs } = await openWithRemote();
    const creating = beginCreateBranch(store, undefined, dialogs);
    await until(() => dialogs.current?.kind === 'form', 'form tạo nhánh');
    dialogs.submit({ name: 'main', checkout: true });
    expect(dialogs.current).not.toBeNull();
    dialogs.submit({ name: 'feature/x', checkout: true });
    await creating;
    expect(store.currentBranch).toBe('feature/x');
    expect(lastToast(toasts)).toBe('Đã tạo và chuyển sang nhánh feature/x');

    await switchToBranch(store, 'main');
    expect(store.currentBranch).toBe('main');
    action(toasts, 'Hoàn tác')();
    await until(() => store.currentBranch === 'feature/x', 'hoàn tác đổi nhánh');
  });

  it('checkout nhánh remote tạo nhánh local theo dõi', async () => {
    const { store, other } = await openWithRemote();
    rawGit(other, ['switch', '-q', '-c', 'tu-remote']);
    rawGit(other, ['push', '-q', 'origin', 'tu-remote']);
    await fetch(store);
    const remoteRef = store.remoteBranches.find((ref) => ref.fullName === 'refs/remotes/origin/tu-remote');
    expect(remoteRef).toBeDefined();
    await checkout(store, remoteRef!);
    expect(store.currentBranch).toBe('tu-remote');
    expect(store.currentBranchRef?.upstream).toBe('origin/tu-remote');
  });

  it('thay đổi chặn đổi nhánh: "Stash rồi checkout" rồi Pop stash', async () => {
    const { test, store, toasts } = await openWithRemote();
    test.git('switch', '-q', '-c', 'khac');
    await test.write('a.txt', 'trên nhánh khác\n');
    test.git('commit', '-q', '-am', 'Sửa a trên nhánh khác');
    test.git('switch', '-q', 'main');
    await test.write('a.txt', 'đang sửa dở\n');
    await store.refreshAndWait(7);

    await switchToBranch(store, 'khac');
    expect(lastToast(toasts)).toBe('Không checkout được vì có thay đổi chưa commit');
    action(toasts, 'Stash rồi checkout')();
    await until(() => store.currentBranch === 'khac' && store.stashes.length === 1, 'stash rồi checkout');

    test.git('switch', '-q', 'main');
    await store.refreshAndWait(7);
    await popLatestStash(store);
    expect(store.stashes).toHaveLength(0);
    expect(store.status.unstaged.map((change) => change.path)).toEqual(['a.txt']);
  });

  it('stash nhanh và hoàn tác', async () => {
    const { test, store, toasts } = await openWithRemote();
    await test.write('moi.txt', 'mới\n');
    await store.refreshAndWait(7);
    await quickStash(store);
    expect(store.stashes).toHaveLength(1);
    expect(store.status.unstaged).toHaveLength(0);
    action(toasts, 'Hoàn tác')();
    await until(() => store.stashes.length === 0 && store.status.unstaged.length === 1, 'pop lại');
  });
});
