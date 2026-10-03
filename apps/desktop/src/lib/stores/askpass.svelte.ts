// Hỏi tên đăng nhập / mật khẩu / passphrase trong app khi git/ssh cần (askpass tương tác). Mỗi câu hỏi là một hộp thoại form;
// nhiều câu hỏi thì lần lượt. Lệnh xong / bị huỷ trước khi trả lời thì Rust báo `askpass-closed` → đóng hộp thoại, không trả
// lời nữa. Không bao giờ log câu hỏi / câu trả lời; câu trả lời giữ nguyên (không cắt khoảng trắng — mật khẩu có thể có).

import type { AskpassClosedEvent, AskpassRequestEvent } from '@thaigit/contracts';
import { vi } from '../strings.vi.ts';
import { dialogs as globalDialogs, type DialogStore, type FormField } from './dialogs.svelte.ts';

export interface AskpassPort {
  reply(requestId: string, answer: string | null): Promise<void>;
  onRequest(handler: (event: AskpassRequestEvent) => void): Promise<() => void>;
  onClosed(handler: (event: AskpassClosedEvent) => void): Promise<() => void>;
}

function describe(request: AskpassRequestEvent): { title: string; message: string; field: FormField } {
  const parts = [vi.remote.askpassWaiting(request.operation)];
  switch (request.kind) {
    case 'username':
      return {
        title: vi.remote.askpassUsernameTitle(request.host),
        message: parts.join('\n'),
        field: { kind: 'text', id: 'answer', label: vi.remote.askpassUsernameLabel, value: '' },
      };
    case 'password':
      if (request.host === 'github.com') parts.push(vi.remote.askpassGithubToken);
      parts.push(vi.remote.askpassPrivacy);
      return {
        title: vi.remote.askpassPasswordTitle(request.host),
        message: parts.join('\n'),
        field: { kind: 'password', id: 'answer', label: vi.remote.askpassPasswordLabel, value: '' },
      };
    case 'passphrase':
      parts.push(request.prompt, vi.remote.askpassPrivacy);
      return {
        title: vi.remote.askpassPassphraseTitle,
        message: parts.join('\n'),
        field: { kind: 'password', id: 'answer', label: vi.remote.askpassPassphraseLabel, value: '' },
      };
    case 'other':
      // Câu hỏi khác của ssh (vd. xác nhận khoá của máy chủ lần đầu): phải đọc nguyên văn để quyết định.
      return {
        title: vi.remote.askpassOtherTitle,
        message: `${parts[0]}\n\n${request.prompt}`,
        field: { kind: 'text', id: 'answer', label: vi.remote.askpassOtherLabel, value: '' },
      };
  }
}

export class AskpassStore {
  private port: AskpassPort | null = null;
  private readonly dialogs: DialogStore;
  private queue: AskpassRequestEvent[] = [];
  /** Câu hỏi đang hiện: id yêu cầu + id hộp thoại. */
  private showing: { requestId: string; dialogId: number | null } | null = null;
  private expired = new Set<string>();
  private stops: (() => void)[] = [];

  constructor(options: { dialogs?: DialogStore } = {}) {
    this.dialogs = options.dialogs ?? globalDialogs;
  }

  async start(port: AskpassPort): Promise<void> {
    this.port = port;
    this.stops.push(
      await port.onRequest((request) => {
        this.queue.push(request);
        void this.next();
      }),
    );
    this.stops.push(await port.onClosed((event) => this.close(event.requestId)));
  }

  stop(): void {
    for (const stop of this.stops.splice(0)) stop();
    this.port = null;
  }

  private close(requestId: string): void {
    this.queue = this.queue.filter((request) => request.requestId !== requestId);
    if (this.showing?.requestId !== requestId) return;
    this.expired.add(requestId);
    if (this.dialogs.current?.id === this.showing.dialogId) this.dialogs.answer('cancel');
  }

  private async next(): Promise<void> {
    if (this.showing || !this.port) return;
    const request = this.queue.shift();
    if (!request) return;
    const { title, message, field } = describe(request);
    const pending = this.dialogs.form({
      title,
      message,
      fields: [field],
      confirmTitle: vi.remote.askpassContinue,
    });
    this.showing = { requestId: request.requestId, dialogId: this.dialogs.current?.id ?? null };
    const values = await pending;
    this.showing = null;
    if (this.expired.delete(request.requestId)) {
      void this.next();
      return;
    }
    const raw = values?.['answer'];
    const answer = typeof raw === 'string' ? raw : null;
    // Câu hỏi có thể vừa hết hiệu lực phía Rust: lỗi "không còn hiệu lực" là bình thường, bỏ qua.
    await this.port?.reply(request.requestId, answer).catch(() => undefined);
    void this.next();
  }
}

export const askpass = new AskpassStore();
