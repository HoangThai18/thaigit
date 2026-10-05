// Profile: đọc và đổi tên & email Git của repo.
import { afterEach, describe, expect, it } from 'vitest';
import { editIdentity, loadIdentity } from '../src/lib/actions/identity.ts';
import { DialogStore } from '../src/lib/stores/dialogs.svelte.ts';
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

describe('profile: tên & email Git', () => {
  it('đọc danh tính, kiểm email, ghi cho riêng repo', async () => {
    const test = await openTestPort((git) => {
      git('commit', '-q', '--allow-empty', '-m', 'gốc');
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
    await until(() => store.hasLoaded, 'nạp xong');

    const before = await loadIdentity(store);
    const dialogs = new DialogStore();
    const editing = editIdentity(store, before, dialogs);
    await until(() => dialogs.current !== null, 'hộp danh tính');
    const form = dialogs.current;
    if (form?.kind !== 'form') throw new Error('không phải form');
    expect(form.validate?.({ name: 'Thái', email: 'sai-email', scope: 'local' })).toBe('Email chưa đúng');
    expect(form.validate?.({ name: ' ', email: 'a@b.c', scope: 'local' })).toBe('Nhập tên');
    dialogs.submit({ name: 'Phan Thái', email: 'thai@example.com', scope: 'local' });
    expect(await editing).toBe(true);

    expect(await loadIdentity(store)).toEqual({ name: 'Phan Thái', email: 'thai@example.com' });
    expect(test.git('config', '--local', 'user.email').trim()).toBe('thai@example.com');
  });
});
