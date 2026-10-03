// Diff ảnh: lấy đúng byte bản cũ / bản mới theo nguồn diff, trên repo git thật.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { imageType, loadImagePair } from '../src/lib/diff/images.ts';
import { PrefsStore } from '../src/lib/stores/prefs.svelte.ts';
import { RepoStore, Scope } from '../src/lib/stores/repo.svelte.ts';
import { ToastStore } from '../src/lib/stores/toasts.svelte.ts';
import { openTestPort } from './helpers/node-port.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const PNG_A = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
const PNG_B = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7]);

const bytesOf = (side: { kind: string; bytes?: Uint8Array }) =>
  side.kind === 'bytes' ? [...(side.bytes ?? [])] : side.kind;

describe('diff ảnh', () => {
  it('nhận ra file ảnh theo đuôi', () => {
    expect(imageType('logo.PNG')).toBe('image/png');
    expect(imageType('a/b.jpeg')).toBe('image/jpeg');
    expect(imageType('icon.svg')).toBeNull();
    expect(imageType('Makefile')).toBeNull();
  });

  it('chưa stage / đã stage / commit / file mới', async () => {
    const test = await openTestPort((git, root) => {
      writeFileSync(join(root, 'logo.png'), PNG_A);
      git('add', '.');
      git('commit', '-q', '-m', 'Thêm logo');
    });
    cleanups.push(() => test.cleanup());
    const store = new RepoStore(test.port, {
      prefs: new PrefsStore(null),
      toasts: new ToastStore(),
      detailsDelayMs: 0,
      clipboard: async () => {},
    });
    cleanups.push(() => store.dispose());
    await store.start();
    writeFileSync(join(test.root, 'logo.png'), PNG_B);
    writeFileSync(join(test.root, 'moi.png'), PNG_A);
    await store.refreshAndWait(Scope.all);
    const context = { headOid: store.headOid, stashes: store.stashes };
    const change = { path: 'logo.png', kind: 'modified' as const };

    const unstaged = await loadImagePair(store.git, { kind: 'unstaged' }, change, context);
    expect([bytesOf(unstaged.old), bytesOf(unstaged.new)]).toEqual([[...PNG_A], [...PNG_B]]);

    const fresh = await loadImagePair(
      store.git,
      { kind: 'unstaged' },
      { path: 'moi.png', kind: 'untracked' },
      context,
    );
    expect([bytesOf(fresh.old), bytesOf(fresh.new)]).toEqual(['none', [...PNG_A]]);

    test.git('add', 'logo.png');
    const staged = await loadImagePair(store.git, { kind: 'staged' }, change, context);
    expect([bytesOf(staged.old), bytesOf(staged.new)]).toEqual([[...PNG_A], [...PNG_B]]);

    test.git('commit', '-q', '-m', 'Đổi logo');
    const sha = test.git('rev-parse', 'HEAD').trim();
    const parent = test.git('rev-parse', 'HEAD~1').trim();
    const commit = await loadImagePair(store.git, { kind: 'commit', sha, parent }, change, context);
    expect([bytesOf(commit.old), bytesOf(commit.new)]).toEqual([[...PNG_A], [...PNG_B]]);
  });
});
