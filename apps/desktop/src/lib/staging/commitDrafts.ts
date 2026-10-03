// Bản nháp commit theo từng repo (khoá: đường dẫn gốc repo), lưu ở localStorage của webview: đóng app, đổi repo hay mở lại
// cửa sổ vẫn còn message đang gõ dở. Ghi trễ một nhịp (gõ phím liên tục), ghi ngay khi trang sắp đóng. Dữ liệu đọc ra luôn
// được kiểm lại vì localStorage có thể bị sửa / hỏng.

import { browserStorage, type KeyValueStorage } from '../stores/prefs.svelte.ts';

export const DRAFTS_KEY = 'thaigit.commitDrafts.v1';
/** Giữ tối đa chừng này repo (bỏ bản nháp cũ nhất) để localStorage không phình mãi. */
export const DRAFTS_MAX = 50;
const SAVE_DELAY_MS = 400;

export interface CommitDraftText {
  readonly summary: string;
  readonly body: string;
}

interface StoredDraft extends CommitDraftText {
  /** Lần sửa cuối (ms) — để bỏ bản cũ nhất khi vượt trần. */
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

  /** Bản nháp đã lưu của repo (rỗng nếu chưa có). Bản đang chờ ghi được ưu tiên. */
  load(root: string): CommitDraftText {
    const waiting = this.pending.get(root);
    if (waiting) return waiting;
    const stored = this.read()[root];
    return stored ? { summary: stored.summary, body: stored.body } : { summary: '', body: '' };
  }

  /** Ghi (trễ một nhịp). Tóm tắt và mô tả đều trống thì xoá bản nháp của repo. */
  save(root: string, draft: CommitDraftText): void {
    this.pending.set(root, { summary: draft.summary, body: draft.body });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  /** Ghi ngay mọi bản đang chờ (trang sắp đóng, hoặc test). */
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
      // Hết dung lượng / bị chặn: bản nháp chỉ sống trong phiên này.
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
