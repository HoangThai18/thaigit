// Per-repo commit drafts (keyed by the repo's root path), stored in the webview's localStorage: closing the
// app, switching repo or reopening the window keeps a half-typed message. Writes are debounced (typing
// continuously), immediate when the page is about to close. Data read back is always revalidated because
// localStorage can be edited or corrupted.

import { browserStorage, type KeyValueStorage } from '../stores/prefs.svelte.ts';

export const DRAFTS_KEY = 'thaigit.commitDrafts.v1';
/** Keep drafts for at most this many repos (oldest dropped) so localStorage can't grow forever. */
export const DRAFTS_MAX = 50;
const SAVE_DELAY_MS = 400;

export interface CommitDraftText {
  readonly summary: string;
  readonly body: string;
}

interface StoredDraft extends CommitDraftText {
  /** Last edit time (ms) — used to drop the oldest draft once the cap is hit. */
  readonly at: number;
}

type DraftMap = Record<string, StoredDraft>;

function sanitize(raw: unknown): DraftMap {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const result: DraftMap = {};
  for (const [root, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const { summary, body, at } = value as Record<string, unknown>;
    if (typeof summary !== 'string' || typeof body !== 'string') continue;
    if (summary.trim() === '' && body.trim() === '') continue;
    result[root] = { summary, body, at: typeof at === 'number' && Number.isFinite(at) ? at : 0 };
  }
  return result;
}

export class CommitDrafts {
  private readonly pending = new Map<string, CommitDraftText>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly storage: KeyValueStorage | null = browserStorage()) {}

  /** The repo's saved draft (empty when there is none). A pending write wins over the stored one. */
  load(root: string): CommitDraftText {
    const waiting = this.pending.get(root);
    if (waiting) return waiting;
    const stored = this.read()[root];
    return stored ? { summary: stored.summary, body: stored.body } : { summary: '', body: '' };
  }

  /** Write (debounced). When both summary and description are blank the repo's draft is deleted. */
  save(root: string, draft: CommitDraftText): void {
    this.pending.set(root, { summary: draft.summary, body: draft.body });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  /** Flush every pending write immediately (page about to close, or a test). */
  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending.size === 0 || this.storage === null) {
      this.pending.clear();
      return;
    }
    const drafts = this.read();
    const now = Date.now();
    for (const [root, draft] of this.pending) {
      if (draft.summary.trim() === '' && draft.body.trim() === '') delete drafts[root];
      else drafts[root] = { ...draft, at: now };
    }
    this.pending.clear();
    const kept = Object.entries(drafts)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, DRAFTS_MAX);
    try {
      if (kept.length === 0) this.storage.setItem(DRAFTS_KEY, '{}');
      else this.storage.setItem(DRAFTS_KEY, JSON.stringify(Object.fromEntries(kept)));
    } catch {
      // Out of quota / blocked: the draft only lives for this session.
    }
  }

  private read(): DraftMap {
    try {
      const text = this.storage?.getItem(DRAFTS_KEY);
      return text ? sanitize(JSON.parse(text)) : {};
    } catch {
      return {};
    }
  }
}

export const commitDrafts = new CommitDrafts();

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => commitDrafts.flush());
  window.addEventListener('beforeunload', () => commitDrafts.flush());
}
