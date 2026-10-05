// Dialogs (confirm + form) and pop-up menus: Esc / Enter keys, form validation, running a menu item, arrow-key navigation.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { DialogStore, type FormValues } from '../../src/lib/stores/dialogs.svelte.ts';
import { MenuStore, tidyMenu } from '../../src/lib/stores/menus.svelte.ts';
import DialogHost from '../../src/lib/ui/DialogHost.svelte';
import MenuHost from '../../src/lib/ui/MenuHost.svelte';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function host(): HTMLElement {
  const target = document.createElement('div');
  document.body.append(target);
  cleanups.push(() => target.remove());
  return target;
}

function key(target: EventTarget, name: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  flushSync();
}

describe('DialogHost', () => {
  it('Esc khi tiêu điểm ở trong hộp xác nhận = Huỷ', async () => {
    const store = new DialogStore();
    const app = mount(DialogHost, { target: host(), props: { store } });
    cleanups.push(() => unmount(app));
    const answer = store.ask({ title: 'Xoá?', message: 'Chắc chưa', confirmTitle: 'Xoá', destructive: true });
    flushSync();
    const primary = document.querySelector<HTMLButtonElement>('.button.primary');
    expect(primary?.textContent).toBe('Xoá');
    expect(document.activeElement).toBe(primary);
    key(primary!, 'Escape');
    expect(await answer).toBe('cancel');
    expect(document.querySelector('.dialog')).toBeNull();
  });

  it('form: kiểm tra tên, Enter gửi giá trị đã sửa', async () => {
    const store = new DialogStore();
    const app = mount(DialogHost, { target: host(), props: { store } });
    cleanups.push(() => unmount(app));
    const result = store.form({
      title: 'Tạo nhánh',
      confirmTitle: 'Tạo',
      fields: [
        { kind: 'text', id: 'name', label: 'Tên', value: '' },
        { kind: 'checkbox', id: 'checkout', label: 'Chuyển sang', value: true },
      ],
      validate: (values: FormValues) => (values['name'] === '' ? 'Nhập tên' : null),
    });
    flushSync();
    const input = document.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(document.activeElement).toBe(input);
    expect(document.querySelector('.error')?.textContent).toBe('Nhập tên');
    expect(document.querySelector<HTMLButtonElement>('.button.primary')!.disabled).toBe(true);
    // Enter while errors remain: nothing is submitted.
    key(input, 'Enter');
    expect(store.current).not.toBeNull();

    input.value = 'feature/x';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(document.querySelector('.error')).toBeNull();
    const box = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    box.click();
    flushSync();
    key(input, 'Enter');
    expect(await result).toEqual({ name: 'feature/x', checkout: false });
  });

  it('hộp mới thay hộp cũ: hộp cũ coi như Huỷ', async () => {
    const store = new DialogStore();
    const first = store.form({ title: 'A', confirmTitle: 'OK', fields: [] });
    const second = store.confirm({ title: 'B', message: '', confirmTitle: 'OK' });
    expect(await first).toBeNull();
    store.answer('confirm');
    expect(await second).toBe(true);
  });
});

describe('MenuHost', () => {
  it('mở dưới nút, phím ↓ / Enter chạy mục, đóng rồi trả tiêu điểm về nút', () => {
    const store = new MenuStore();
    const target = host();
    const opener = document.createElement('button');
    opener.textContent = 'Pull ▾';
    target.append(opener);
    const app = mount(MenuHost, { target, props: { store } });
    cleanups.push(() => unmount(app));
    const calls: string[] = [];
    store.openBelow(
      opener,
      tidyMenu([
        { kind: 'separator' },
        { title: 'Merge', run: () => calls.push('merge') },
        { title: 'Không được', disabled: true, run: () => calls.push('disabled') },
        { kind: 'separator' },
        { kind: 'separator' },
        { title: 'Rebase', run: () => calls.push('rebase') },
        { kind: 'separator' },
      ]),
      { focusFirst: true },
    );
    flushSync();
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent?.trim())).toEqual(['Merge', 'Không được', 'Rebase']);
    expect(document.querySelectorAll('[role="separator"]')).toHaveLength(1);
    expect(document.activeElement).toBe(items[0]);
    // A disabled entry is skipped while navigating.
    key(document.activeElement!, 'ArrowDown');
    expect(document.activeElement).toBe(items[2]);
    (document.activeElement as HTMLButtonElement).click();
    flushSync();
    expect(calls).toEqual(['rebase']);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('Esc đóng menu, phím không lan ra cửa sổ', () => {
    const store = new MenuStore();
    const target = host();
    const opener = document.createElement('button');
    target.append(opener);
    const app = mount(MenuHost, { target, props: { store } });
    cleanups.push(() => unmount(app));
    let leaked = 0;
    const listener = (): void => {
      leaked++;
    };
    window.addEventListener('keydown', listener);
    cleanups.push(() => window.removeEventListener('keydown', listener));
    store.openBelow(opener, [{ title: 'Một', run: () => {} }], { focusFirst: true });
    flushSync();
    key(document.activeElement!, 'Escape');
    expect(store.current).toBeNull();
    expect(leaked).toBe(0);
  });
});
