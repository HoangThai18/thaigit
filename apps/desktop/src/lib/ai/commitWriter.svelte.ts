// "✨ Viết bằng AI" trong ô soạn commit: dựng ngữ cảnh → hỏi đồng ý (lần đầu) → stream chữ vào ô tóm tắt + mô tả → dọn
// lại sau `done`. Dừng / lỗi giữa chừng → trả ô soạn về nội dung cũ; xong thì giữ nội dung cũ để "Hoàn tác".

import { finalizeCommitMessage } from '@thaigit/core';
import { stageAll } from '../actions/staging.ts';
import { vi } from '../strings.vi.ts';
import type { AiStore } from '../stores/ai.svelte.ts';
import { dialogs } from '../stores/dialogs.svelte.ts';
import type { RepoStore } from '../stores/repo.svelte.ts';
import { toasts } from '../stores/toasts.svelte.ts';
import { AiFailure } from './client.ts';
import { commitContext } from './context.ts';

export type WriterPhase = 'idle' | 'preparing' | 'queued' | 'writing';

interface Draft {
  summary: string;
  body: string;
}

export class CommitWriter {
  phase = $state<WriterPhase>('idle');
  /** Vị trí trong hàng đợi của máy chủ (khi `phase === 'queued'`). */
  position = $state(0);
  /** Nội dung ô soạn trước lần AI viết gần nhất (cho "Hoàn tác"); `null` khi không có gì để hoàn tác. */
  previous = $state.raw<Draft | null>(null);
  #controller: AbortController | null = null;
  readonly #store: RepoStore;
  readonly #ai: AiStore;

  constructor(store: RepoStore, ai: AiStore) {
    this.#store = store;
    this.#ai = ai;
  }

  get running(): boolean {
    return this.phase !== 'idle';
  }

  async start(): Promise<void> {
    if (this.running) return;
    const store = this.#store;
    const draft = store.commitDraft;
    this.phase = 'preparing';
    const controller = new AbortController();
    this.#controller = controller;
    const before: Draft = { summary: draft.summary, body: draft.body };
    let wrote = false;
    const restore = () => {
      draft.summary = before.summary;
      draft.body = before.body;
    };
    try {
      const { status } = store;
      if (status.staged.length === 0 && !draft.amend) {
        if (status.unstaged.length === 0 || status.conflicts.length > 0) {
          toasts.info(vi.ai.nothingToSend);
          return;
        }
        const stage = await dialogs.confirm({
          title: vi.ai.stageAllTitle,
          message: vi.ai.stageAllMessage,
          confirmTitle: vi.ai.stageAllConfirm,
        });
        if (!stage || controller.signal.aborted) return;
        await stageAll(store);
      }
      const prepared = await commitContext(store.git, this.#ai, {
        branch: store.currentBranch,
        oid: store.headOid,
        amend: draft.amend,
      });
      if (prepared === null) {
        toasts.info(vi.ai.nothingToSend);
        return;
      }
      if (controller.signal.aborted || !(await this.#ai.askConsent(prepared.preview))) return;
      this.phase = 'writing';
      let raw = '';
      for await (const frame of this.#ai.run('commit', prepared.request, controller.signal)) {
        if (frame.type === 'queued') {
          this.phase = 'queued';
          this.position = frame.position;
        } else if (frame.type === 'delta') {
          this.phase = 'writing';
          raw += frame.text;
          const parts = finalizeCommitMessage(raw);
          draft.summary = parts.summary;
          draft.body = parts.body;
          wrote = true;
        } else if (frame.type === 'done') {
          const parts = finalizeCommitMessage(raw);
          if (parts.summary === '') throw new AiFailure('empty');
          draft.summary = parts.summary;
          draft.body = parts.body;
          this.previous = before;
          void this.#ai.refreshQuota();
          return;
        } else {
          throw new AiFailure(frame.code, frame.retryAfter);
        }
      }
      throw new AiFailure(controller.signal.aborted ? 'cancelled' : 'network');
    } catch (error) {
      if (wrote) restore();
      const cancelled =
        controller.signal.aborted || (error instanceof AiFailure && error.code === 'cancelled');
      if (!cancelled) {
        toasts.error(vi.ai.errors.title, error, { tag: 'ai' });
        if (error instanceof AiFailure && error.code === 'quota_exhausted') void this.#ai.refreshQuota();
      }
    } finally {
      if (this.#controller === controller) this.#controller = null;
      this.phase = 'idle';
    }
  }

  stop(): void {
    this.#controller?.abort();
  }

  /** Trả ô soạn về nội dung trước khi AI viết. */
  undo(): void {
    const previous = this.previous;
    if (previous === null) return;
    this.#store.commitDraft.summary = previous.summary;
    this.#store.commitDraft.body = previous.body;
    this.previous = null;
  }
}
