/**
 * Blame a file in the centre area (replacing the graph, like GitKraken's "File Blame"): which commit each
 * line belongs to, who wrote it and when.
 * A `null` `rev` means the version being edited in the working tree (uncommitted lines are shown apart).
 */
import type { Blame, GitRepository } from '@thaigit/core';
import { friendlyError } from '../errors/friendly.ts';

export interface BlameTarget {
  readonly path: string;
  /** Commit to blame; `null` = the working tree. */
  readonly rev: string | null;
}

export type BlameState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly blame: Blame }
  /** `message`: a friendly sentence (errors/friendly.ts), not a raw error. */
  | { readonly kind: 'failed'; readonly message: string };

/** The slice of `RepoStore` that blame needs (avoids a circular import). */
export interface BlameHost {
  readonly git: GitRepository;
  /** Opening blame closes the diff on screen (both occupy the centre area). */
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
