// TrustPrompt dựng bằng Svelte thật: danh sách findings trùng không được làm đứng cả lượt cập nhật, và hộp thoại phải nhận focus.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import TrustPrompt from '../../src/lib/shell/TrustPrompt.svelte';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function mountPrompt(findings: string[], overrides: { busy?: boolean } = {}): HTMLElement {
  const target = document.createElement('div');
  document.body.append(target);
  const app = mount(TrustPrompt, {
    target,
    props: {
      name: 'repo',
      path: '/tmp/repo',
      findings,
      busy: overrides.busy ?? false,
      ontrust() {},
      oncancel() {},
    },
  });
  cleanups.push(() => {
    unmount(app);
    target.remove();
  });
  flushSync();
  return target;
}

describe('TrustPrompt (H2b)', () => {
  it('findings trùng nhau vẫn dựng được hộp thoại (không ném each_key_duplicate)', () => {
    const line = 'include.path = ../.gitconfig  (local, file:.git/config)';
    const root = mountPrompt([line, line, 'hook: pre-commit']);
    expect([...root.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      line,
      line,
      'hook: pre-commit',
    ]);
    expect(root.querySelectorAll('button')).toHaveLength(2);
  });
});

describe('TrustPrompt (L2)', () => {
  it('khi mở, focus nằm ở nút Huỷ (lựa chọn an toàn), không rơi ra ngoài hộp thoại', async () => {
    const root = mountPrompt(['hook: pre-commit']);
    await tick();
    const cancel = root.querySelector<HTMLButtonElement>('button.secondary');
    expect(cancel).not.toBeNull();
    expect(document.activeElement).toBe(cancel);
    expect(root.querySelector('[role="alertdialog"]')?.contains(document.activeElement)).toBe(true);
  });
});
