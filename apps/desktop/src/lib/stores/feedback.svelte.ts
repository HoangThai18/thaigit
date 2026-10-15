// Whether the "Feedback & bug report" dialog is open (one dialog for the whole window) and which kind it opened with.

import type { FeedbackKind } from '../feedback/compose.ts';

export class FeedbackStore {
  isOpen = $state(false);
  kind = $state<FeedbackKind>('bug');

  open(kind: FeedbackKind = 'bug'): void {
    this.kind = kind;
    this.isOpen = true;
  }

  close(): void {
    this.isOpen = false;
  }
}

export const feedback = new FeedbackStore();
