// Tìm commit trên graph (port tìm kiếm của RepoModel.swift): khớp tiêu đề, tác giả, email, tiền tố SHA, tên nhánh / tag —
// không phân biệt hoa thường và dấu ("dang nhap" khớp "Đăng nhập"). Chỉ trong các commit đã tải.

import { isWorkingTreeCommit } from '@thaigit/core';
import { containsFolded, foldText } from '../format/natural.ts';
import type { GraphEntry, RepoStore } from '../stores/repo.svelte.ts';

/** Chỉ số các hàng khớp `query` (bỏ dòng WIP). */
export function findMatches(entries: readonly GraphEntry[], query: string): number[] {
  const trimmed = query.trim();
  if (trimmed === '') return [];
  const folded = foldText(trimmed);
  const sha = trimmed.toLowerCase();
  const matches: number[] = [];
  entries.forEach((entry, index) => {
    const commit = entry.commit;
    if (isWorkingTreeCommit(commit)) return;
    if (
      containsFolded(commit.subject, folded) ||
      containsFolded(commit.authorName, folded) ||
      containsFolded(commit.authorEmail, folded) ||
      (/^[0-9a-f]{4,}$/.test(sha) && commit.id.startsWith(sha)) ||
      entry.labels.some((label) => containsFolded(label.text, folded))
    ) {
      matches.push(index);
    }
  });
  return matches;
}

export class GraphSearch {
  open = $state(false);
  query = $state('');
  readonly #store: RepoStore;
  readonly matches = $derived.by(() => findMatches(this.#store.entries, this.query));
  readonly matchSet = $derived(new Set(this.matches));

  constructor(store: RepoStore) {
    this.#store = store;
  }

  get active(): boolean {
    return this.open && this.query.trim() !== '';
  }

  show(): void {
    this.open = true;
  }

  close(): void {
    this.open = false;
    this.query = '';
  }

  /** Chọn hàng khớp kế tiếp (hoặc trước đó) tính từ hàng đang chọn, vòng lại khi hết. */
  next(backward = false): void {
    const matches = this.matches;
    if (matches.length === 0) return;
    const current = this.#store.selectedRow ?? (backward ? Number.MAX_SAFE_INTEGER : -1);
    const target = backward
      ? ([...matches].reverse().find((row) => row < current) ?? matches[matches.length - 1])
      : (matches.find((row) => row > current) ?? matches[0]);
    const entry = target === undefined ? undefined : this.#store.entryAt(target);
    if (entry) this.#store.select({ kind: 'commit', sha: entry.commit.id }, true);
  }
}
