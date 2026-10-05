// In-app askpass against a fake "Rust": the dialog varies by question kind, answers pass through
// untouched, Cancel = null, an expired question closes the dialog without answering, and several
// questions queue up one after another.
import { describe, expect, it } from 'vitest';
import type { AskpassClosedEvent, AskpassRequestEvent } from '@thaigit/contracts';
import { AskpassStore, type AskpassPort } from '../src/lib/stores/askpass.svelte.ts';
import { DialogStore } from '../src/lib/stores/dialogs.svelte.ts';

function request(
  id: string,
  kind: AskpassRequestEvent['kind'],
  host: string | null = 'github.com',
): AskpassRequestEvent {
  return { requestId: id, opId: 'op', operation: 'git push', kind, host, prompt: `prompt ${id}` };
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Hết giờ chờ: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

async function setup() {
  const dialogs = new DialogStore();
  const store = new AskpassStore({ dialogs });
  const replies: [string, string | null][] = [];
  let ask: ((event: AskpassRequestEvent) => void) | null = null;
  let close: ((event: AskpassClosedEvent) => void) | null = null;
  const port: AskpassPort = {
    async reply(id, answer) {
      replies.push([id, answer]);
    },
    async onRequest(handler) {
      ask = handler;
      return () => (ask = null);
    },
    async onClosed(handler) {
      close = handler;
      return () => (close = null);
    },
  };
  await store.start(port);
  return {
    dialogs,
    store,
    replies,
    ask: (event: AskpassRequestEvent) => ask?.(event),
    close: (id: string) => close?.({ requestId: id }),
  };
}

describe('AskpassStore', () => {
  it('mật khẩu GitHub: ô ẩn ký tự, nhắc dùng token, trả lời giữ nguyên khoảng trắng', async () => {
    const { dialogs, replies, ask } = await setup();
    ask(request('r1', 'password'));
    await until(() => dialogs.current !== null, 'hộp thoại');
    const form = dialogs.current;
    if (form?.kind !== 'form') throw new Error('phải là form');
    expect(form.title).toBe('Mật khẩu cho github.com');
    expect(form.message).toContain('Personal access token');
    expect(form.fields[0]?.kind).toBe('password');
    dialogs.submit({ answer: '  có dấu cách  ' });
    await until(() => replies.length === 1, 'trả lời');
    expect(replies).toEqual([['r1', '  có dấu cách  ']]);
  });

  it('Huỷ thì trả null; nhiều câu hỏi hiện lần lượt', async () => {
    const { dialogs, replies, ask } = await setup();
    ask(request('u', 'username'));
    ask(request('p', 'password', 'gitlab.example.vn'));
    await until(() => dialogs.current !== null, 'câu hỏi 1');
    expect(dialogs.current?.title).toBe('Đăng nhập github.com');
    dialogs.submit({ answer: 'thai' });
    await until(() => dialogs.current?.title === 'Mật khẩu cho gitlab.example.vn', 'câu hỏi 2');
    dialogs.answer('cancel');
    await until(() => replies.length === 2, 'hai câu trả lời');
    expect(replies).toEqual([
      ['u', 'thai'],
      ['p', null],
    ]);
  });

  it('câu hỏi hết hiệu lực (lệnh xong / bị huỷ): đóng hộp thoại, không trả lời', async () => {
    const { dialogs, replies, ask, close } = await setup();
    ask(request('x', 'passphrase', null));
    ask(request('y', 'other', null));
    await until(() => dialogs.current !== null, 'hộp thoại');
    expect(dialogs.current?.title).toBe('Passphrase của khoá SSH');
    close('y');
    close('x');
    await until(() => dialogs.current === null, 'đóng');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(replies).toEqual([]);
    expect(dialogs.current).toBeNull();
  });
});
