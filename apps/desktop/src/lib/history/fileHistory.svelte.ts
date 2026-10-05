/**
 * History of one file (right-hand panel, replacing the details when opened — like GitKraken's "File
 * History"): the commits that touched the file, followed across renames. Pick a commit to see that file's
 * own changes in the centre area.
 */
import type { FileHistoryEntry, GitRepository } from '@thaigit/core';
import type { DiffStore } from '../stores/diff.svelte.ts';
import { vi } from '../strings.vi.ts';

/** Commits read in one go (a heavily changed file still opens fast). */
export const FILE_HISTORY_LIMIT = 500;

/** The slice of `RepoStore` that file history needs (avoids a circular import). */
export interface FileHistoryHost {
  readonly git: GitRepository;
  readonly diff: DiffStore;
  /** Panels that share the right-hand slot: opening file history closes the Timeline. */
  closeTimeline(): void;
  /** Opening file history closes the PR review (same right-hand slot). */
  closeReview?(): void;
  showError(title: string, error: unknown): void;
}

export class FileHistoryStore {
  /** Path whose history is on screen (its current name); `null` = panel closed. */
  path = $state<string | null>(null);
  entries = $state.raw<readonly FileHistoryEntry[]>([]);
  loading = $state(false);
  failed = $state(false);
  selected = $state.raw<FileHistoryEntry | null>(null);
  private token = 0;

  constructor(private readonly host: FileHistoryHost) {}

  get isOpen(): boolean {
    return this.path !== null;
  }

  /** The read limit has been hit: there may be older commits. */
  get limited(): boolean {
    return this.entries.length >= FILE_HISTORY_LIMIT;
  }

  open(path: string): void {
    this.host.closeTimeline();
    this.host.closeReview?.();
    this.path = path;
    this.entries = [];
    this.selected = null;
    void this.load();
  }

  close(): void {
    if (this.path === null) return;
    this.token++;
    this.path = null;
    this.entries = [];
    this.selected = null;
    this.loading = false;
    this.failed = false;
    if (this.host.diff.file?.source.kind === 'commit') this.host.diff.close();
  }

  async load(): Promise<void> {
    const path = this.path;
    if (path === null) return;
    const token = ++this.token;
    this.loading = true;
    this.failed = false;
    try {
      const entries = await this.host.git.fileHistory(path, FILE_HISTORY_LIMIT);
      if (token === this.token) this.entries = entries;
    } catch (error) {
      if (token !== this.token) return;
      this.failed = true;
      this.host.showError(vi.history.loadFailed, error);
    } finally {
      if (token === this.token) this.loading = false;
    }
  }

  /** Pick a commit: open that file's changes (versus its first parent) in the centre area. */
  select(entry: FileHistoryEntry): void {
    this.selected = entry;
    const commit = entry.commit;
    this.host.diff.open(entry.change, { kind: 'commit', sha: commit.id, parent: commit.parents[0] ?? null });
  }
}
