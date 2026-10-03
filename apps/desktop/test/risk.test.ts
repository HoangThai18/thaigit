import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PrefsStore } from '../src/lib/stores/prefs.svelte.ts';
import { RepoStore } from '../src/lib/stores/repo.svelte.ts';
import { ToastStore } from '../src/lib/stores/toasts.svelte.ts';
import { openTestPort } from './helpers/node-port.ts';

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('RiskStore', () => {
  it('cờ theo nội dung mới thêm, kể cả khi file vốn đã ở trạng thái sửa', async () => {
    const test = await openTestPort((git, root) => {
      writeFileSync(join(root, 'app.ts'), 'export const a = 1;\n');
      git('add', '.');
      git('commit', '-q', '-m', 'Khởi tạo');
    });
    cleanups.push(() => test.cleanup());
    const store = new RepoStore(test.port, {
      prefs: new PrefsStore(null),
      toasts: new ToastStore(),
      detailsDelayMs: 0,
      clipboard: async () => {},
    });
    cleanups.push(() => store.dispose());
    await test.write('app.ts', 'export const a = 2;\n');
    await store.refreshAndWait(1);
    await store.risks.refresh();
    expect(store.risks.flags).toEqual([]);

    await test.write(
      'app.ts',
      "export const a = 2;\nconst token = 'ghp_0123456789abcdefghijABCDEFGHIJ012345';\n",
    );
    await store.refreshAndWait(1);
    await store.risks.refresh();
    expect(store.risks.flags).toEqual([{ code: 'secret', paths: ['app.ts'] }]);
  });
});
