/**
 * Review the changes of one branch against another (right-hand panel, replacing the details when opened):
 * the files that differ from the point where the branch left the other one — the same view as a Pull
 * Request's "Files changed", but for local refs with no server involved. Clicking a file shows its diff in
 * the centre area.
 */
import { refName, type FileChange, type GitRef, type GitRepository } from '@thaigit/core';
import type { DiffSource, DiffStore } from '../stores/diff.svelte.ts';
import { vi } from '../strings.vi.ts';

/** The slice of `RepoStore` that branch review needs (avoids a circular import). */
export interface BranchReviewHost {
  readonly git: GitRepository;
  readonly diff: DiffStore;
  readonly refs: readonly GitRef[];
  /** Panels that share the right-hand slot: opening the review closes Timeline / File history / PR review. */
  closeTimeline(): void;
  closeFileHistory(): void;
  closeReview(): void;
  showError(title: string, error: unknown): void;
}

/** The branch's changes: from the merge base (`from`) to the tip of the branch (`head`). */
export interface BranchChanges {
  readonly head: string;
  readonly from: string;
  readonly files: readonly FileChange[];
}

export type BranchReviewPhase = 'loading' | 'ready' | 'failed';

export class BranchReviewStore {
  /** Branch under review and the branch it is compared with; `null` = the panel is closed. */
  head = $state.raw<GitRef | null>(null);
  base = $state.raw<GitRef | null>(null);
  phase = $state<BranchReviewPhase>('loading');
  changes = $state.raw<BranchChanges | null>(null);
  /** Bumped on every open / close / reload: a late result from an earlier run is discarded. */
  private token = 0;

  constructor(private readonly host: BranchReviewHost) {}

  get isOpen(): boolean {
    return this.head !== null && this.base !== null;
  }

  /** `base...head`: the identifier shown above the diff and in the panel header. */
  get label(): string {
    return this.head && this.base ? `${refName(this.base)}...${refName(this.head)}` : '';
  }

  open(head: GitRef, base: GitRef): void {
    this.host.closeTimeline();
    this.host.closeFileHistory();
    this.host.closeReview();
    this.dropOpenDiff();
    this.head = head;
    this.base = base;
    this.changes = null;
    void this.load();
  }

  /** Reload against the refs as they are now (after a fetch / commit the tips have moved). */
  async load(): Promise<void> {
    if (this.head === null || this.base === null) return;
    const head = this.host.refs.find((ref) => ref.fullName === this.head?.fullName) ?? this.head;
    const base = this.host.refs.find((ref) => ref.fullName === this.base?.fullName) ?? this.base;
    const token = ++this.token;
    this.phase = 'loading';
    try {
      const from = (await this.host.git.mergeBase(base.target, head.target)) ?? base.target;
      const files = await this.host.git.changedFiles(head.target, from);
      if (token !== this.token) return;
      if (this.changes?.head !== head.target || this.changes.from !== from) this.dropOpenDiff();
      this.changes = { head: head.target, from, files };
      this.phase = 'ready';
    } catch (error) {
      if (token !== this.token) return;
      this.phase = 'failed';
      this.host.showError(vi.branches.reviewLoadFailed, error);
    }
  }

  close(): void {
    if (!this.isOpen) return;
    this.token++;
    this.dropOpenDiff();
    this.head = null;
    this.base = null;
    this.changes = null;
    this.phase = 'loading';
  }

  /** File path of the open diff inside the review (highlights the list row), if any. */
  get openPath(): string | null {
    const changes = this.changes;
    const open = this.host.diff.file;
    if (changes === null || open === null || open.source.kind !== 'commit') return null;
    return open.source.sha === changes.head && open.source.parent === changes.from ? open.change.path : null;
  }

  diffSource(): DiffSource | null {
    const changes = this.changes;
    return changes === null
      ? null
      : { kind: 'commit', sha: changes.head, parent: changes.from, label: this.label };
  }

  /** Open the diff of one file of the review in the centre area. */
  openFile(change: FileChange): void {
    const source = this.diffSource();
    if (source !== null) this.host.diff.open(change, source);
  }

  /** Closing the panel (or reloading it) also closes this review's diff; a commit's diff is left alone. */
  private dropOpenDiff(): void {
    const changes = this.changes;
    const open = this.host.diff.file;
    if (changes === null || open === null || open.source.kind !== 'commit') return;
    if (open.source.sha === changes.head && open.source.parent === changes.from) this.host.diff.close();
  }
}
