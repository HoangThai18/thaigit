/**
 * Blame một file ở vùng giữa (thay graph, như "File Blame" của GitKraken): mỗi dòng thuộc commit nào, ai viết, khi nào.
 * `rev` null = bản đang sửa trong working tree (dòng chưa commit hiện riêng).
 */
import type { Blame, GitRepository } from '@thaigit/core';
import { friendlyError } from '../errors/friendly.ts';

export interface BlameTarget {
  readonly path: string;
  /** Commit để blame; `null` = working tree. */
  readonly rev: string | null;
}

export type BlameState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly blame: Blame }
  /** `message`: câu thân thiện (errors/friendly.ts), không phải lỗi thô. */
  | { readonly kind: 'failed'; readonly message: string };

/** Phần của `RepoStore` mà blame cần (tránh import vòng). */
export interface BlameHost {
  readonly git: GitRepository;
  /** Mở blame thì đóng diff đang xem (hai thứ cùng chiếm vùng giữa). */
  closeDiff(): void;
}

export class BlameStore {
  target = $state.raw<BlameTarget | null>(null);
  state = $state.raw<BlameState>({ kind: 'idle' });
  private token = 0;

  constructor(private readonly host: BlameHost) {}

  open(path: string, rev: string | null): void {
    this.host.closeDiff();
    const current = this.target;
    if (current !== null && current.path === path && current.rev === rev && this.state.kind !== 'failed')
      return;
    this.target = { path, rev };
    void this.load();
  }

  close(): void {
    if (this.target === null) return;
    this.token++;
    this.target = null;
    this.state = { kind: 'idle' };
  }

  async load(): Promise<void> {
    const target = this.target;
    if (target === null) return;
    const token = ++this.token;
    this.state = { kind: 'loading' };
    try {
      const blame = await this.host.git.blame(target.path, target.rev);
      if (token === this.token) this.state = { kind: 'ready', blame };
    } catch (error) {
      if (token === this.token) this.state = { kind: 'failed', message: friendlyError(error) };
    }
  }
}
