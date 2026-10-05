// Fetch / pull / push / tạo nhánh / đổi nhánh / stash — chạy trên repo git thật với "remote" là repo bare cục bộ.
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { shouldAutoFetch } from '../src/lib/actions/autoFetch.ts';
import { beginCreateBranch, checkout, switchToBranch } from '../src/lib/actions/branches.ts';
import {
  beginAddRemote,
  beginEditRemoteUrl,
  beginRenameRemote,
  remoteMenu,
  removeRemote,
} from '../src/lib/actions/manageRemotes.ts';
import { backgroundFetch, completeHistory, fetch, pull, push, sync } from '../src/lib/actions/remote.ts';
import { commit } from '../src/lib/actions/commit.ts';
import { quickStash } from '../src/lib/actions/stash.ts';
import { DialogStore } from '../src/lib/stores/dialogs.svelte.ts';
import { PrefsStore } from '../src/lib/stores/prefs.svelte.ts';
import { RepoStore } from '../src/lib/stores/repo.svelte.ts';
import { ToastStore } from '../src/lib/stores/toasts.svelte.ts';
import { vi as strings } from '../src/lib/strings.vi.ts';
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
  const store = new RepoStore(test.port, {
    prefs: new PrefsStore(null),
    toasts,
    detailsDelayMs: 0,
    clipboard: async () => {},
  });
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
  const toast = [...toasts.items]
    .reverse()
    .find((item) => item.actions.some((candidate) => candidate.title === title));
  const found = toast?.actions.find((candidate) => candidate.title === title);
  if (!found)
    throw new Error(
      `Không thấy nút “${title}” (toast: ${toasts.items.map((item) => item.title).join(' | ')})`,
    );
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
    expect(lastToast(toasts)).toBe('Nhánh local và remote đã diverge');
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
    expect(lastToast(toasts)).toBe('Nhánh moi chưa có upstream trên remote');
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
    expect(toasts.items.at(-1)?.actions.map((item) => item.title)).toEqual([
      'Pull rồi Push',
      'Pull trước',
      'Force push…',
    ]);

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

describe('đồng bộ / commit & push', () => {
  it('"Pull rồi Push" khi remote có commit mới: kéo về rồi đẩy lên trong một bước', async () => {
    const { test, store, dialogs, bare, other } = await openWithRemote();
    pushFromOther(other, 'b.txt', 'b\n', 'Của đồng nghiệp');
    await test.write('c.txt', 'c\n');
    test.git('add', '.');
    test.git('commit', '-q', '-m', 'Của tôi');
    await store.refreshAndWait(7);

    await sync(store, dialogs);
    expect(test.git('log', '--format=%s').split('\n')).toContain('Của đồng nghiệp');
    expect(rawGit(bare, ['rev-parse', 'main']).trim()).toBe(store.headOid);
    expect(store.status.ahead).toBe(0);
  });

  it('commit & push: commit xong đẩy luôn; commit lỗi thì không push', async () => {
    const { test, store, bare } = await openWithRemote();
    const remoteBefore = rawGit(bare, ['rev-parse', 'main']).trim();
    store.commitDraft.summary = 'Không có gì';
    await commit(store, { push: true });
    expect(rawGit(bare, ['rev-parse', 'main']).trim()).toBe(remoteBefore);

    await test.write('a.txt', 'một\nhai\n');
    await store.refreshAndWait(1);
    store.commitDraft.summary = 'Sửa a';
    await commit(store, { stageAllFirst: true, push: true });
    expect(test.git('log', '-1', '--format=%s').trim()).toBe('Sửa a');
    expect(rawGit(bare, ['rev-parse', 'main']).trim()).toBe(store.headOid);
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

  it('thay đổi chặn đổi nhánh: tự stash, checkout rồi mang thay đổi theo; xung đột thì giữ stash', async () => {
    const { test, store, toasts } = await openWithRemote();
    await test.write('a.txt', '1\n2\n3\n4\n5\n6\n7\n8\n');
    test.git('commit', '-q', '-am', 'Tám dòng');
    test.git('switch', '-q', '-c', 'khac');
    await test.write('a.txt', 'MỘT\n2\n3\n4\n5\n6\n7\n8\n');
    test.git('commit', '-q', '-am', 'Sửa dòng đầu trên nhánh khác');
    test.git('switch', '-q', 'main');
    // Sửa dòng cuối: chặn checkout nhưng áp lại sạch.
    await test.write('a.txt', '1\n2\n3\n4\n5\n6\n7\nTÁM\n');
    await store.refreshAndWait(7);

    await switchToBranch(store, 'khac');
    await until(() => store.currentBranch === 'khac' && !store.isPerforming, 'tự stash rồi checkout');
    expect(lastToast(toasts)).toBe('Checkout khac xong — đã mang theo thay đổi chưa commit');
    expect(store.stashes).toHaveLength(0);
    expect(readFileSync(join(test.root, 'a.txt'), 'utf8')).toBe('MỘT\n2\n3\n4\n5\n6\n7\nTÁM\n');

    // Sửa cùng dòng với nhánh kia: áp lại xung đột, stash vẫn còn.
    test.git('checkout', '-q', '--', 'a.txt');
    test.git('switch', '-q', 'main');
    await test.write('a.txt', 'one\n2\n3\n4\n5\n6\n7\n8\n');
    await store.refreshAndWait(7);
    await switchToBranch(store, 'khac');
    await until(() => store.currentBranch === 'khac' && !store.isPerforming, 'checkout có xung đột');
    expect(lastToast(toasts)).toBe(
      'Checkout khac xong, nhưng thay đổi chưa commit bị xung đột với nhánh mới',
    );
    expect(store.stashes).toHaveLength(1);
    expect(store.status.conflicts.map((entry) => entry.path)).toEqual(['a.txt']);
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

  it('remote chỉ theo dõi một nhánh: báo thiếu nhánh, "Fetch đầy đủ từ remote" đưa nhánh khác về', async () => {
    const { test, store, toasts, other } = await openWithRemote();
    rawGit(other, ['switch', '-q', '-c', 'feature/x']);
    pushFromOther(other, 'x.txt', 'x\n', 'Nhánh feature');
    rawGit(other, ['push', '-q', 'origin', 'feature/x']);
    // Như `git clone --single-branch`: chỉ lấy main.
    test.git('config', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main');
    await store.refreshAndWait(7);
    expect(store.historyGaps).toEqual({ shallow: false, narrowRemotes: ['origin'] });

    await fetch(store);
    expect(store.remoteBranches.map((ref) => ref.fullName)).not.toContain('refs/remotes/origin/feature/x');

    await completeHistory(store);
    expect(lastToast(toasts)).toBe('Đã fetch đủ nhánh và lịch sử từ remote');
    expect(store.historyGaps).toEqual({ shallow: false, narrowRemotes: [] });
    expect(store.remoteBranches.map((ref) => ref.fullName)).toContain('refs/remotes/origin/feature/x');
  });
});

describe('quản lý remote', () => {
  it('thêm remote qua form (fetch luôn), sửa địa chỉ, đổi tên, xoá rồi hoàn tác', async () => {
    const { store, toasts, dialogs, bare } = await openWithRemote();
    const backup = `${bare.slice(0, -'origin.git'.length)}backup.git`;
    rawGit(store.rootPath, ['init', '-q', '--bare', '-b', 'main', backup]);
    rawGit(store.rootPath, ['push', '-q', backup, 'main']);

    const adding = beginAddRemote(store, dialogs);
    await until(() => dialogs.current !== null, 'form thêm remote');
    const form = dialogs.current;
    if (form?.kind !== 'form') throw new Error('không phải form');
    expect(form.validate?.({ name: 'origin', url: backup, fetch: true })).toBe(
      strings.remote.remoteExists('origin'),
    );
    expect(form.validate?.({ name: '-x', url: backup, fetch: true })).toBe(strings.remote.remoteNameInvalid);
    expect(form.validate?.({ name: 'backup', url: '', fetch: true })).toBe(strings.remote.remoteUrlRequired);
    dialogs.submit({ name: 'backup', url: backup, fetch: true });
    await adding;
    await until(() => store.remotes.length === 2, 'có remote mới');
    await until(
      () => store.remoteBranches.some((ref) => ref.fullName === 'refs/remotes/backup/main'),
      'đã fetch remote mới',
    );

    const backupRemote = store.remotes.find((remote) => remote.name === 'backup')!;
    const editing = beginEditRemoteUrl(store, backupRemote, dialogs);
    await until(() => dialogs.current !== null, 'form sửa địa chỉ');
    dialogs.submit({ url: bare });
    await editing;
    await until(() => store.remotes.find((remote) => remote.name === 'backup')?.fetchUrl === bare, 'đổi URL');

    const renaming = beginRenameRemote(
      store,
      store.remotes.find((remote) => remote.name === 'backup')!,
      dialogs,
    );
    await until(() => dialogs.current !== null, 'form đổi tên');
    dialogs.submit({ name: 'dự-phòng' });
    await renaming;
    await until(
      () => store.remoteBranches.some((ref) => ref.fullName === 'refs/remotes/dự-phòng/main'),
      'đổi tên kéo theo nhánh remote',
    );

    const removing = removeRemote(
      store,
      store.remotes.find((remote) => remote.name === 'dự-phòng')!,
      dialogs,
    );
    await until(() => dialogs.current !== null, 'hỏi xoá');
    expect(dialogs.current?.kind === 'confirm' && dialogs.current.destructive).toBe(true);
    dialogs.answer('confirm');
    await removing;
    await until(() => store.remotes.length === 1, 'đã xoá');
    action(toasts, strings.remote.undoRemoveRemote)();
    await until(() => store.remotes.some((remote) => remote.name === 'dự-phòng'), 'hoàn tác xoá');
    expect(store.remotes.find((remote) => remote.name === 'dự-phòng')?.fetchUrl).toBe(bare);
  });

  it('menu remote có fetch / sửa / đổi tên / sao chép / xoá', async () => {
    const { store } = await openWithRemote();
    const titles = remoteMenu(store, store.remotes[0]!).flatMap((item) =>
      item.kind === 'separator' ? [] : [item.title],
    );
    expect(titles).toEqual([
      strings.remote.fetchRemote('origin'),
      strings.remote.editRemoteUrl,
      strings.remote.renameRemote,
      strings.remote.copyRemoteUrl,
      strings.remote.removeRemote,
    ]);
  });
});
