// Repo "biên" cho test giao diện: dữ liệu mà git cho phép nhưng giao diện dễ giả định là không xảy ra (stash trùng sha, commit có
// hai cha giống hệt, remote có "/" trong tên, tên nhánh/tệp chứa ký tự đảo chiều bidi).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrefsStore } from '../../src/lib/stores/prefs.svelte.ts';
import { RepoStore } from '../../src/lib/stores/repo.svelte.ts';
import { ToastStore } from '../../src/lib/stores/toasts.svelte.ts';
import { rawGit, openTestPort, type TestPort } from './node-port.ts';

type Git = (...args: string[]) => string;

export function commitFile(git: Git, root: string, name: string, content: string, message: string): void {
  writeFileSync(join(root, name), content);
  git('add', '--', name);
  git('commit', '-q', '-m', message);
}

/** Commit `dup parents` có HAI dòng `parent` giống hệt (git không tạo bằng `commit-tree` nhưng `hash-object` thì được). */
export function makeDupParentCommit(git: Git, root: string, branch: string): string {
  const parent = git('rev-parse', 'HEAD').trim();
  const tree = git('rev-parse', 'HEAD^{tree}').trim();
  const raw = [
    `tree ${tree}`,
    `parent ${parent}`,
    `parent ${parent}`,
    'author A <a@x> 1700000000 +0000',
    'committer A <a@x> 1700000000 +0000',
    '',
    'dup parents',
    '',
  ].join('\n');
  const sha = rawGit(root, ['hash-object', '-t', 'commit', '-w', '--stdin'], raw).trim();
  git('branch', branch, sha);
  return sha;
}

/**
 * Hai mục stash cùng sha: cất một stash, cất thêm một cái khác, rồi `git stash store` lại commit stash đầu (git bỏ qua nếu trùng
 * với mục trên cùng nên phải có mục khác chen giữa). Kết quả: stash@{0} và stash@{2} cùng sha.
 */
export function makeDuplicateStash(git: Git, root: string): void {
  writeFileSync(join(root, 'a.txt'), 'đang sửa dở\n');
  git('stash', 'push', '-q', '-m', 'dở dang');
  const sha = git('rev-parse', 'stash@{0}').trim();
  writeFileSync(join(root, 'b.txt'), 'sửa dở khác\n');
  git('stash', 'push', '-q', '-m', 'dở dang khác');
  git('stash', 'store', '-m', 'dở dang (bản sao)', sha);
}

export function setupEdge(git: Git, root: string): void {
  commitFile(git, root, 'a.txt', 'một\n', 'commit 1');
  commitFile(git, root, 'b.txt', 'hai\n', 'commit 2');
  commitFile(git, root, 'c.txt', 'ba\n', 'commit 3');
  makeDupParentCommit(git, root, 'dup-parent');
  makeDuplicateStash(git, root);
  // Remote "team/a" (có "/" trong tên) và "origin": chỉ cần cấu hình + ref theo dõi, không cần mạng.
  git('remote', 'add', 'origin', 'https://example.com/origin.git');
  git('remote', 'add', 'team/a', 'https://example.com/team-a.git');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('update-ref', 'refs/remotes/team/a/main', 'HEAD');
  git('update-ref', 'refs/remotes/team/a/feature/x', 'HEAD');
}

export async function until(condition: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Hết giờ chờ: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export interface LoadedRepo {
  readonly test: TestPort;
  readonly store: RepoStore;
  readonly toasts: ToastStore;
  readonly cleanup: () => Promise<void>;
}

/** Mở repo `setup` bằng RepoStore thật và chờ nạp xong; `cleanup` dọn store + thư mục tạm. */
export async function openLoaded(
  setup: Parameters<typeof openTestPort>[0],
  options: { commitLimit?: number } = {},
): Promise<LoadedRepo> {
  const test = await openTestPort(setup);
  const prefs = new PrefsStore(null);
  if (options.commitLimit !== undefined) prefs.update({ commitLimit: options.commitLimit });
  const toasts = new ToastStore();
  const store = new RepoStore(test.port, { prefs, toasts, detailsDelayMs: 0, clipboard: async () => {} });
  await store.start();
  await until(() => store.hasLoaded && !store.isLoadingHistory, 'repo nạp xong');
  return {
    test,
    store,
    toasts,
    cleanup: async () => {
      await store.dispose();
      await test.cleanup();
    },
  };
}
