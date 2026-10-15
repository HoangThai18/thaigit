// The "Feedback & bug report" dialog with real Svelte: an empty message is refused, sending opens a mailto: URL to
// the feedback address (with version + OS unless unticked), a failed open keeps the dialog and the text.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import FeedbackDialog from '../../src/lib/feedback/FeedbackDialog.svelte';
import { FEEDBACK_EMAIL } from '../../src/lib/feedback/compose.ts';
import { FeedbackStore } from '../../src/lib/stores/feedback.svelte.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function setup(openMail: (url: string) => Promise<void>) {
  const store = new FeedbackStore();
  const target = document.createElement('div');
  document.body.append(target);
  const app = mount(FeedbackDialog, {
    target,
    props: { store, version: '2.6.0', system: 'macOS (aarch64)', openMail, copy: async () => {} },
  });
  cleanups.push(() => {
    unmount(app);
    target.remove();
  });
  store.open('bug');
  flushSync();
  return { store, target };
}

function type(target: HTMLElement, text: string): void {
  const field = target.querySelector('textarea') as HTMLTextAreaElement;
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

async function click(target: HTMLElement, label: string): Promise<void> {
  const button = [...target.querySelectorAll('button')].find((item) => item.textContent === label);
  button?.click();
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

describe('FeedbackDialog', () => {
  it('không gửi khi trống; gửi thì mở mailto kèm phiên bản + hệ điều hành rồi đóng', async () => {
    const opened: string[] = [];
    const { store, target } = setup(async (url) => {
      opened.push(url);
    });
    await click(target, 'Soạn email');
    expect(opened).toEqual([]);
    expect(store.isOpen).toBe(true);

    type(target, 'Bấm Push bị treo');
    await click(target, 'Soạn email');
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0] ?? '');
    expect(url.protocol).toBe('mailto:');
    expect(decodeURIComponent(url.pathname)).toBe(FEEDBACK_EMAIL);
    expect(url.searchParams.get('subject')).toBe('[Gitlane] Báo lỗi');
    expect(url.searchParams.get('body')).toBe(
      'Bấm Push bị treo\n\n---\nPhiên bản Gitlane: 2.6.0\nHệ điều hành: macOS (aarch64)',
    );
    expect(store.isOpen).toBe(false);
  });

  it('bỏ tick thông tin máy thì thân thư chỉ còn nội dung; mở lỗi thì giữ hộp thoại', async () => {
    const opened: string[] = [];
    const { store, target } = setup(async (url) => {
      opened.push(url);
      throw new Error('no mail app');
    });
    const idea = target.querySelector('input[value=idea]') as HTMLInputElement;
    idea.click();
    flushSync();
    const include = target.querySelector('input[type=checkbox]') as HTMLInputElement;
    include.click();
    flushSync();
    type(target, 'Thêm phím tắt cho Fetch');
    await click(target, 'Soạn email');
    const url = new URL(opened[0] ?? '');
    expect(url.searchParams.get('subject')).toBe('[Gitlane] Góp ý');
    expect(url.searchParams.get('body')).toBe('Thêm phím tắt cho Fetch');
    expect(store.isOpen).toBe(true);
    expect((target.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Thêm phím tắt cho Fetch');
  });
});
