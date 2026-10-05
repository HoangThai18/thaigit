// "Edge case" repos for UI tests: data git allows but the UI tends to assume can't happen (stashes sharing a
// sha, a commit with two identical parents, a remote name containing "/", branch / file names with bidi
// characters).
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

/** Commit `dup parents` has TWO identical `parent` lines (`commit-tree` won't produce that but `hash-object` does). */
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
 * Two stash entries sharing a sha: stash once, stash another, then `git stash store` the first stash's commit
 * again (git skips a duplicate of the topmost entry, so another entry has to sit in between).
 * Result: stash@{0} and stash@{2} share a sha.
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
  // Remote "team/a" (a name containing "/") plus "origin": configuration + a tracking ref is enough, no network needed.
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

/** Open repo `setup` with a real RepoStore and wait for the load to finish; `cleanup` tears down the store and the temp directory. */
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
