/**
 * Review a Pull Request / Merge Request (right-hand panel, replacing the details when opened): the PR's
 * description and the files changed relative to the merge base against the target branch — GitHub /
 * GitLab's "Files changed". Clicking a file shows that file's diff in the centre area.
 *
 * The store only holds state; fetching the branches and computing the file list lives in `openReview.ts`
 * (run through the repo's operation queue).
 */
import type { ForgeMergeRequest, ForgePerson, ForgeProvider } from '@thaigit/contracts';
import type { FileChange } from '@thaigit/core';
import type { DiffSource, DiffStore } from '../stores/diff.svelte.ts';

/** The slice of `RepoStore` that review needs (avoids a circular import). */
export interface ReviewHost {
  readonly diff: DiffStore;
  /** Panels that share the right-hand slot: opening review closes Timeline / File history. */
  closeTimeline(): void;
  closeFileHistory(): void;
}

/** The PR's changes: from the merge base (`from`) to the tip of the PR branch (`head`). */
export interface ReviewChanges {
  readonly head: string;
  readonly from: string;
  readonly files: readonly FileChange[];
}

export type ReviewPhase = 'loading' | 'ready' | 'failed';

/** People who can be assigned (loaded the first time the picker opens for the current PR). */
export type PeoplePhase = 'idle' | 'loading' | 'ready' | 'failed';

export class ReviewStore {
  /** PR being reviewed; `null` = the panel is closed. */
  request = $state.raw<ForgeMergeRequest | null>(null);
  /** The repo's host kind (changes how PR / MR are called). */
  provider = $state<ForgeProvider | null>(null);
  phase = $state<ReviewPhase>('loading');
  changes = $state.raw<ReviewChanges | null>(null);
  /** People assignable to a PR / MR (GitHub: repo assignees, GitLab: project members). */
  candidates = $state.raw<readonly ForgePerson[]>([]);
  peoplePhase = $state<PeoplePhase>('idle');
  /** A reviewer / assignee change is being sent to the host. */
  saving = $state(false);
  /** Bumped after each successful save: the sidebar's PR / MR list reloads to match. */
  peopleVersion = $state(0);
  /** Bumped on every open / close / reload: a late result from an earlier run is discarded. */
  private token = 0;
  private peopleToken = 0;

  constructor(private readonly host: ReviewHost) {}

  get isOpen(): boolean {
    return this.request !== null;
  }

  /** Start (or reload) the review of `request`; returns this run's id so `finish` / `fail` recognise their own result. */
  begin(request: ForgeMergeRequest, provider: ForgeProvider | null): number {
    this.host.closeTimeline();
    this.host.closeFileHistory();
    const same =
      this.request !== null && this.request.host === request.host && this.request.number === request.number;
    if (!same) {
      this.dropOpenDiff();
      this.resetPeople();
    }
    this.request = request;
    this.provider = provider;
    this.phase = 'loading';
    if (!same) this.changes = null;
    return ++this.token;
  }

  finish(token: number, changes: ReviewChanges): void {
    if (token !== this.token || this.request === null) return;
    this.changes = changes;
    this.phase = 'ready';
  }

  fail(token: number): void {
    if (token !== this.token || this.request === null) return;
    this.phase = 'failed';
  }

  close(): void {
    if (this.request === null) return;
    this.token++;
    this.dropOpenDiff();
    this.request = null;
    this.changes = null;
    this.phase = 'loading';
    this.resetPeople();
  }

  /** Start loading the assignable-people list; `null` if it is already loading or loaded (reopening the picker doesn't refetch). */
  beginPeople(): number | null {
    if (this.request === null || this.peoplePhase === 'loading' || this.peoplePhase === 'ready') return null;
    this.peoplePhase = 'loading';
    return ++this.peopleToken;
  }

  finishPeople(token: number, people: readonly ForgePerson[]): void {
    if (token !== this.peopleToken || this.request === null) return;
    this.candidates = people;
    this.peoplePhase = 'ready';
  }

  failPeople(token: number): void {
    if (token !== this.peopleToken || this.request === null) return;
    this.peoplePhase = 'failed';
  }

  /** Mark a save as in flight; returns `false` when no PR is open or a save is already running (never submit twice). */
  beginSaving(): boolean {
    if (this.request === null || this.saving) return false;
    this.saving = true;
    return true;
  }

  /** Save finished: take the PR / MR re-read from the host (only if the same PR is still open). */
  finishSaving(updated: ForgeMergeRequest): void {
    this.saving = false;
    const request = this.request;
    if (request === null || request.host !== updated.host || request.number !== updated.number) return;
    this.request = updated;
    this.peopleVersion += 1;
  }

  failSaving(): void {
    this.saving = false;
  }

  private resetPeople(): void {
    this.peopleToken++;
    this.candidates = [];
    this.peoplePhase = 'idle';
    this.saving = false;
  }

  /** File path of the open diff inside the PR (highlights the list row), if any. */
  get openPath(): string | null {
    const changes = this.changes;
    const open = this.host.diff.file;
    if (changes === null || open === null || open.source.kind !== 'commit') return null;
    return open.source.sha === changes.head && open.source.parent === changes.from ? open.change.path : null;
  }

  /** Diff source of the PR (branch tip vs merge base); `label` is the identifier shown above the diff (e.g. `#12`). */
  diffSource(label: string): DiffSource | null {
    const changes = this.changes;
    return changes === null ? null : { kind: 'commit', sha: changes.head, parent: changes.from, label };
  }

  /** Open the diff of one PR file in the centre area. */
  openFile(change: FileChange, label: string): void {
    const source = this.diffSource(label);
    if (source !== null) this.host.diff.open(change, source);
  }

  /** Closing the panel also closes the PR's diff (a commit's diff is left alone). */
  private dropOpenDiff(): void {
    const changes = this.changes;
    const open = this.host.diff.file;
    if (changes === null || open === null || open.source.kind !== 'commit') return;
    if (open.source.sha === changes.head && open.source.parent === changes.from) this.host.diff.close();
  }
}
