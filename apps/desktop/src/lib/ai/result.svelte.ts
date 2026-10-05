// Markdown result box for the AI features (commit explanation, PR description): one box at a time, text
// streams in, with Stop / Regenerate / Copy. Errors show inside the box as a friendly sentence.

import type { AiFeature, AiRequestByFeature } from '@thaigit/contracts';
import { finalizeMarkdown, stripThinking } from '@thaigit/core';
import { friendlyError } from '../errors/friendly.ts';
import { ai as defaultAi, type AiStore } from '../stores/ai.svelte.ts';
import { AiFailure } from './client.ts';
import type { Prepared } from './context.ts';

export type ResultPhase = 'preparing' | 'queued' | 'writing' | 'done' | 'error';

export interface ResultJob<F extends AiFeature = AiFeature> {
  title: string;
  feature: F;
  /** Build the context (reads git); `null` = nothing to send (`emptyText`). */
  prepare: () => Promise<Prepared<AiRequestByFeature[F]> | null>;
  emptyText: string;
}

export class AiResultStore {
  job = $state.raw<ResultJob | null>(null);
  phase = $state<ResultPhase>('preparing');
  text = $state('');
  position = $state(0);
  error = $state<string | null>(null);
  #controller: AbortController | null = null;
  #serial = 0;
  readonly #ai: AiStore;

  constructor(ai: AiStore = defaultAi) {
    this.#ai = ai;
  }

  get running(): boolean {
    return this.job !== null && this.phase !== 'done' && this.phase !== 'error';
  }

  open<F extends AiFeature>(job: ResultJob<F>): Promise<void> {
    this.close();
    this.job = job as unknown as ResultJob;
    return this.#run();
  }

  regenerate(): Promise<void> {
    if (this.job === null || this.running) return Promise.resolve();
    return this.#run();
  }

  stop(): void {
    this.#controller?.abort();
  }

  close(): void {
    this.#controller?.abort();
    this.#controller = null;
    this.job = null;
  }

  async #run(): Promise<void> {
    const job = this.job;
    if (job === null) return;
    const serial = ++this.#serial;
    const controller = new AbortController();
    this.#controller = controller;
    const current = () => this.#serial === serial && this.job === job;
    this.phase = 'preparing';
    this.text = '';
    this.error = null;
    let raw = '';
    try {
      const prepared = await job.prepare();
      if (!current()) return;
      if (prepared === null) {
        this.phase = 'error';
        this.error = job.emptyText;
        return;
      }
      if (!(await this.#ai.askConsent(prepared.preview))) {
        if (current()) this.close();
        return;
      }
      for await (const frame of this.#ai.run(job.feature, prepared.request, controller.signal)) {
        if (!current()) return;
        if (frame.type === 'queued') {
          this.phase = 'queued';
          this.position = frame.position;
        } else if (frame.type === 'delta') {
          this.phase = 'writing';
          raw += frame.text;
          this.text = stripThinking(raw).trimStart();
        } else if (frame.type === 'done') {
          this.text = finalizeMarkdown(raw);
          if (this.text === '') throw new AiFailure('empty');
          this.phase = 'done';
          void this.#ai.refreshQuota();
          return;
        } else {
          throw new AiFailure(frame.code, frame.retryAfter);
        }
      }
      throw new AiFailure(controller.signal.aborted ? 'cancelled' : 'network');
    } catch (error) {
      if (!current()) return;
      this.phase = 'error';
      this.error = friendlyError(error);
    } finally {
      if (this.#controller === controller) this.#controller = null;
    }
  }
}

export const aiResult = new AiResultStore();
