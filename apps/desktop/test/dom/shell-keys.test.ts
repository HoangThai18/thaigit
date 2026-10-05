// Other `{#each}` blocks in the app shell must not break either when the data has duplicates (H2: widening the audit).
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import Toasts from '../../src/lib/shell/Toasts.svelte';
import Welcome from '../../src/lib/shell/Welcome.svelte';
import { toasts } from '../../src/lib/stores/toasts.svelte.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  toasts.clear();
});

function host(): HTMLElement {
  const target = document.createElement('div');
  document.body.append(target);
  cleanups.push(() => target.remove());
  return target;
}

describe('Toasts', () => {
  it('hai nút hành động cùng nhãn vẫn dựng đủ và gọi đúng hàm của từng nút', () => {
    const target = host();
    const app = mount(Toasts, { target });
    cleanups.push(() => unmount(app));
    const calls: string[] = [];
    toasts.info('có hai nút', {
      actions: [
        { title: 'Thử lại', run: () => calls.push('a') },
        { title: 'Thử lại', run: () => calls.push('b') },
      ],
    });
    flushSync();
    const buttons = [...target.querySelectorAll<HTMLButtonElement>('button.action')];
    expect(buttons).toHaveLength(2);
    buttons[1]?.click();
    expect(calls).toEqual(['b']);
  });
});

describe('Welcome', () => {
  it('danh sách gần đây có id trùng (file recent.json bị sửa tay) vẫn hiện đủ từng dòng', () => {
    const target = host();
    const repo = { id: 'r1', name: 'thaigit', path: '/code/thaigit', lastOpened: 1_700_000_000_000 };
    const app = mount(Welcome, {
      target,
      props: {
        recent: [repo, repo, { ...repo, id: 'r2', name: 'khác' }],
        opening: false,
        unavailable: undefined,
        onopen() {},
        onrecent() {},
        onforget() {},
      },
    });
    cleanups.push(() => unmount(app));
    flushSync();
    expect(target.querySelectorAll('ul.recent li')).toHaveLength(3);
  });
});
