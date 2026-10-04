import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrefsStore } from '../src/lib/stores/prefs.svelte.ts';
import { RepoStore } from '../src/lib/stores/repo.svelte.ts';
import { ToastStore } from '../src/lib/stores/toasts.svelte.ts';
import { openTestPort } from './helpers/node-port.ts';

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

describe('diff bỏ qua khoảng trắng', () => {
  it('bật thì ẩn thay đổi thụt lề và tắt stage từng dòng; tắt thì như cũ', async () => {
    const test = await openTestPort((git, root) => {
      writeFileSync(join(root, 'a.ts'), 'function x() {\n  return 1;\n}\n');
      git('add', '.');
      git('commit', '-q', '-m', 'gốc');
    });
    cleanups.push(() => test.cleanup());
    const prefs = new PrefsStore(null);
    const store = new RepoStore(test.port, {
      prefs,
      toasts: new ToastStore(),
      detailsDelayMs: 0,
      clipboard: async () => {},
    });
    cleanups.push(() => store.dispose());
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    await test.write('a.ts', 'function x() {\n    return 1;\n}\n// mới\n');
    await store.refreshAndWait(1);

    store.diff.open(store.status.unstaged[0]!, { kind: 'unstaged' });
    await until(() => store.diff.state.kind === 'text', 'diff');
    expect(store.diff.fileDiff!.additions).toBe(2);
    expect(store.diff.supportsPartial).toBe(true);

    prefs.update({ diffIgnoreWhitespace: true });
    await store.diff.load();
    expect(store.diff.fileDiff!.additions).toBe(1);
    expect(store.diff.supportsPartial).toBe(false);

    prefs.update({ diffIgnoreWhitespace: false });
    await store.diff.load();
    expect(store.diff.fileDiff!.additions).toBe(2);
    expect(store.diff.supportsPartial).toBe(true);
  });
});
