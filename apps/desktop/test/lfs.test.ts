import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DiffPresentation } from '@thaigit/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  beginTrackLfs,
  lfsFileItems,
  lfsPatternMenu,
  lfsSectionMenu,
  usesLfs,
} from '../src/lib/actions/lfs.ts';
import { performPush } from '../src/lib/actions/remote.ts';
import { lfsPointerOf } from '../src/lib/diff/lfs.ts';
import { friendlyError } from '../src/lib/errors/friendly.ts';
import { DialogStore } from '../src/lib/stores/dialogs.svelte.ts';
import { isMenuAction, type MenuItem } from '../src/lib/stores/menus.svelte.ts';
import { PrefsStore } from '../src/lib/stores/prefs.svelte.ts';
import { RepoStore } from '../src/lib/stores/repo.svelte.ts';
import { ToastStore } from '../src/lib/stores/toasts.svelte.ts';
import { vi as strings } from '../src/lib/strings.vi.ts';
import { GitError } from '@thaigit/core';
import { openTestPort, rawGit } from './helpers/node-port.ts';

const HAS_LFS = spawnSync('git', ['lfs', 'version']).status === 0;
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

async function openStore(setup: (git: (...args: string[]) => string, root: string) => void) {
  const test = await openTestPort(setup);
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
  await until(() => store.hasLoaded && store.lfsVersion !== undefined, 'nạp xong');
  return { test, store, toasts };
}

function titles(items: readonly MenuItem[]): string[] {
  return items.flatMap((item) =>
    item.kind === 'submenu' ? [item.title, ...titles(item.items)] : isMenuAction(item) ? [item.title] : [],
  );
}

describe('diff của file con trỏ LFS', () => {
  const pointer = [
    'version https://git-lfs.github.com/spec/v1',
    `oid sha256:${'b'.repeat(64)}`,
    'size 2097152',
  ];
  const presentation = (kind: 'addition' | 'deletion', lines: readonly string[]) =>
    ({
      hunks: [{ lines: lines.map((text) => ({ kind, text })) }],
    }) as unknown as DiffPresentation;

  it('nhận con trỏ ở bản mới hoặc bản cũ; diff thường thì không', () => {
    expect(lfsPointerOf(presentation('addition', pointer))).toEqual({ oid: 'b'.repeat(64), size: 2097152 });
    expect(lfsPointerOf(presentation('deletion', pointer))?.size).toBe(2097152);
    expect(lfsPointerOf(presentation('addition', ['xin chào']))).toBeNull();
    expect(lfsPointerOf(null)).toBeNull();
  });

  it('lỗi git-lfs thành câu thân thiện', () => {
    const missing = new GitError(
      ['lfs', 'track'],
      1,
      '',
      "git: 'lfs' is not a git command. See 'git --help'.",
    );
    expect(friendlyError(missing)).toBe(strings.errors.friendly.lfsMissing);
    const server = new GitError(['lfs', 'push'], 2, '', 'batch response: Repository or object not found');
    expect(friendlyError(server)).toBe(strings.errors.friendly.lfsServer);
  });
});

describe.skipIf(!HAS_LFS)('Git LFS trên git-lfs thật', () => {
  it('đọc mẫu, track qua form, bỏ track, menu file; push tự đẩy file LFS', async () => {
    const remote = await realpath(await mkdtemp(join(tmpdir(), 'thaigit-lfs-remote-')));
    cleanups.push(() => rm(remote, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
    rawGit(remote, ['init', '-q', '--bare']);
    const { store, toasts } = await openStore((git, root) => {
      // Bộ lọc LFS nhưng KHÔNG cài hook: chỉ lần `git lfs push` của app mới đẩy được file LFS.
      git('lfs', 'install', '--local', '--skip-repo');
      writeFileSync(join(root, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n');
      writeFileSync(join(root, 'a.bin'), 'nội dung LFS\n'.repeat(50));
      git('add', '.');
      git('commit', '-q', '-m', 'gốc');
      git('remote', 'add', 'origin', pathToFileURL(remote).href);
    });
    expect(store.lfsVersion).toMatch(/^\d+\./);
    expect(store.lfsPatterns.map((item) => item.pattern)).toEqual(['*.bin']);
    expect(usesLfs(store)).toBe(true);
    expect(titles(lfsSectionMenu(store))).toEqual([
      strings.lfs.track,
      strings.lfs.fetch,
      strings.lfs.pull,
      strings.lfs.prune,
    ]);

    const change = { path: 'thư mục/ảnh.psd', kind: 'untracked' } as const;
    expect(titles(lfsFileItems(store, change as never))).toEqual([
      strings.lfs.fileMenu,
      strings.lfs.trackExtension('psd'),
      strings.lfs.trackFile,
    ]);

    const dialogs = new DialogStore();
    const tracking = beginTrackLfs(store, '*.psd', dialogs);
    await until(() => dialogs.current !== null, 'form track');
    const form = dialogs.current;
    if (form?.kind !== 'form') throw new Error('không phải form');
    expect(form.validate?.({ pattern: '' })).toBe(strings.lfs.patternRequired);
    expect(form.validate?.({ pattern: 'a\nb' })).toBe(strings.lfs.patternInvalid);
    expect(form.validate?.({ pattern: '-x' })).toBe(strings.lfs.patternInvalid);
    dialogs.submit({ pattern: '*.psd' });
    await tracking;
    await until(() => store.lfsPatterns.length === 2, 'có mẫu mới');

    const psd = store.lfsPatterns.find((item) => item.pattern === '*.psd')!;
    const untrack = lfsPatternMenu(store, psd).filter(isMenuAction)[0]!;
    expect(untrack.title).toBe(strings.lfs.untrack);
    untrack.run();
    await until(() => store.lfsPatterns.length === 1, 'bỏ mẫu');

    await performPush(store, {
      localBranch: 'main',
      remote: 'origin',
      remoteBranch: 'main',
      setUpstream: true,
      force: false,
    });
    expect(toasts.items.map((toast) => toast.style)).not.toContain('error');
    expect(rawGit(remote, ['rev-parse', 'main']).trim()).toMatch(/^[0-9a-f]{40}$/);
    expect(await readdir(join(remote, 'lfs', 'objects'))).not.toEqual([]);
  });
});
