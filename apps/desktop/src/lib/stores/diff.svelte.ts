// The file open in the centre pane (replacing the graph, like the Swift app's DiffPane): the diff source, the pre-computed
// content to draw, and the lines the user selected to stage / unstage / discard individually. The diff is always fetched
// as BYTES and parsed in the core — a patch rebuilt from it applies byte-exactly (CRLF, BOM, non-UTF-8 encodings).

import {
  buildPresentation,
  conflictAsChange,
  conflictHasMarkers,
  diffLineCount,
  parseConflictFile,
  parseDiff,
  sha256Hex,
  supportsPartialStaging,
  type ConflictEntry,
  type ConflictFile,
  type DiffPresentation,
  type FileChange,
  type FileDiff,
  type GitRepository,
  type Stash,
  type WorkingTreeStatus,
} from '@thaigit/core';
import { friendlyError } from '../errors/friendly.ts';

export type DiffSource =
  | { readonly kind: 'unstaged' }
  | { readonly kind: 'staged' }
  /** `label`: identifying text at the top of the diff instead of "Commit <sha>" (a whole-PR diff against the divergence point from the target branch, e.g. `#12`). */
  | { readonly kind: 'commit'; readonly sha: string; readonly parent: string | null; readonly label?: string }
  | { readonly kind: 'stash'; readonly sha: string }
  /** A conflicting file: open the conflict resolver instead of the diff. */
  | { readonly kind: 'conflict' };

export interface OpenFile {
  readonly source: DiffSource;
  readonly change: FileChange;
}

export type DiffState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'text'; readonly presentation: DiffPresentation }
  | { readonly kind: 'binary' }
  | { readonly kind: 'tooLarge'; readonly diff: FileDiff }
  | { readonly kind: 'empty' }
  /** `message`: a friendly sentence (errors/friendly.ts), not the raw error. */
  | { readonly kind: 'failed'; readonly message: string }
  /** The file has <<<<<<< markers (resolvable per hunk); `sha256` of the bytes read, so writing back is verified. */
  | {
      readonly kind: 'conflict';
      readonly entry: ConflictEntry;
      readonly file: ConflictFile;
      readonly sha256: string;
    }
  /** A conflict that cannot be resolved per hunk (deleted on one side, not UTF-8, no markers found): only the whole file can be chosen. */
  | {
      readonly kind: 'conflictWhole';
      readonly entry: ConflictEntry;
      readonly reason: 'no-markers' | 'not-utf8';
    };

/** Above this line count, ask before drawing (Swift: 20 000). */
export const LARGE_DIFF_LINES = 20_000;

export type LineSelection = ReadonlyMap<number, ReadonlySet<number>>;

const NO_SELECTION: LineSelection = new Map();

/** What the diff store needs from the repo store (factored out so it can be tested without a whole RepoStore). */
export interface DiffHost {
  readonly git: GitRepository;
  readonly status: WorkingTreeStatus;
  readonly stashes: readonly Stash[];
  diffContext(): number;
  /** Ignore whitespace-only changes (view only: it disables per-line staging). */
  diffIgnoreWhitespace(): boolean;
  reportError(title: string, error: unknown): void;
}

export function sameSource(a: DiffSource, b: DiffSource): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'commit' && b.kind === 'commit') return a.sha === b.sha && a.parent === b.parent;
  if (a.kind === 'stash' && b.kind === 'stash') return a.sha === b.sha;
  return true;
}

export function isWorkingTreeSource(source: DiffSource): boolean {
  return source.kind === 'unstaged' || source.kind === 'staged';
}

export class DiffStore {
  file = $state.raw<OpenFile | null>(null);
  state = $state.raw<DiffState>({ kind: 'idle' });
  /** hunk id → selected line indices (within `hunk.lines`). */
  selection = $state.raw<LineSelection>(NO_SELECTION);

  private readonly host: DiffHost;
  private token = 0;
  /** The diff bytes of the last load: reloading the exact same bytes keeps the line selection. */
  private lastBytes: Uint8Array | null = null;
  /** Where the open file sits in its list: when it disappears (staged, discarded…) open whatever is at that position. */
  private position = 0;

  constructor(host: DiffHost) {
    this.host = host;
  }

  get selectedCount(): number {
    let count = 0;
    for (const lines of this.selection.values()) count += lines.size;
    return count;
  }

  /** The displayed diff (parsed), if any. */
  get fileDiff(): FileDiff | null {
    return this.state.kind === 'text' ? this.state.presentation.diff : null;
  }

  /** The list containing the open file (unstaged / staged / conflicts) — `null` for a commit or stash diff. */
  get siblings(): readonly FileChange[] | null {
    return this.file ? this.listFor(this.file.source) : null;
  }

  /** Whether per-hunk or per-line stage / unstage / discard is possible (an ordinary file: not binary, not a mode-only change). */
  get supportsPartial(): boolean {
    const diff = this.fileDiff;
    // A whitespace-ignoring diff no longer matches the real file byte for byte, so a patch built from it cannot be applied.
    return diff !== null && !this.host.diffIgnoreWhitespace() && supportsPartialStaging(diff);
  }

  open(change: FileChange, source: DiffSource): void {
    const current = this.file;
    if (
      current &&
      current.change.path === change.path &&
      current.change.kind === change.kind &&
      sameSource(current.source, source)
    ) {
      return;
    }
    this.file = { source, change };
    this.position = this.indexIn(source, change.path);
    this.selection = NO_SELECTION;
    this.lastBytes = null;
    this.state = { kind: 'loading' };
    void this.load();
  }

  /**
   * The next (`step` = 1) / previous (−1) file within the same list as the open one (unstaged, staged, conflicts). Stays put at
   * the end of the list. Returns `false` when nothing changed.
   */
  step(step: 1 | -1): boolean {
    const file = this.file;
    if (!file) return false;
    const list = this.listFor(file.source);
    if (!list) return false;
    const index = list.findIndex((change) => change.path === file.change.path);
    const next = list[index < 0 ? Math.max(0, Math.min(this.position, list.length - 1)) : index + step];
    if (!next || next.path === file.change.path) return false;
    this.open(next, file.source);
    return true;
  }

  close(): void {
    this.token++;
    this.position = 0;
    this.file = null;
    this.state = { kind: 'idle' };
    this.selection = NO_SELECTION;
    this.lastBytes = null;
  }

  /** Still draw a very large diff (after the user pressed "Show anyway"). */
  showAnyway(): void {
    if (this.state.kind !== 'tooLarge') return;
    this.state = { kind: 'text', presentation: buildPresentation(this.state.diff) };
  }

  toggleLine(hunkId: number, index: number): void {
    const next = new Map(this.selection);
    const lines = new Set(next.get(hunkId) ?? []);
    if (lines.has(index)) lines.delete(index);
    else lines.add(index);
    if (lines.size === 0) next.delete(hunkId);
    else next.set(hunkId, lines);
    this.selection = next;
  }

  isSelected(hunkId: number, index: number): boolean {
    return this.selection.get(hunkId)?.has(index) ?? false;
  }

  clearSelection(): void {
    this.selection = NO_SELECTION;
  }

  /**
   * Call after the status changes: if the open file (an uncommitted change) is still there, reload its diff; if it is gone from
   * the list (all staged, discarded, committed) close it.
   */
  statusDidChange(): void {
    const file = this.file;
    if (!file) return;
    const list = this.listFor(file.source);
    if (!list) return;
    const index = list.findIndex((change) => change.path === file.change.path);
    const current = list[index];
    if (!current) {
      // The file was just staged / unstaged / discarded / resolved: open whatever sits at that spot in the list (like GitHub Desktop) so the
      // review continues without another click; when the list is empty, close and return to the graph.
      const next = list[Math.min(this.position, list.length - 1)];
      if (next) this.open(next, file.source);
      else this.close();
      return;
    }
    this.position = index;
    if (file.source.kind === 'conflict') {
      // The conflicting file may have just changed on disk: reload (when the content is unchanged, `loadConflict` keeps the work in progress).
      void this.load();
      return;
    }
    if (current.kind !== file.change.kind || current.oldPath !== file.change.oldPath) {
      this.file = { source: file.source, change: current };
    }
    void this.load();
  }

  /** The list containing `source`'s files (uncommitted changes, conflicts); `null` for a commit / stash diff. */
  private listFor(source: DiffSource): readonly FileChange[] | null {
    const status = this.host.status;
    switch (source.kind) {
      case 'unstaged':
        return status.unstaged;
      case 'staged':
        return status.staged;
      case 'conflict':
        return status.conflicts.map((entry) => conflictAsChange(entry));
      default:
        return null;
    }
  }

  private indexIn(source: DiffSource, path: string): number {
    const index = this.listFor(source)?.findIndex((change) => change.path === path) ?? -1;
    return Math.max(0, index);
  }

  /** Reload the open file's diff. */
  async load(): Promise<void> {
    const file = this.file;
    if (!file) return;
    const token = ++this.token;
    if (file.source.kind === 'conflict') {
      await this.loadConflict(file, token);
      return;
    }
    try {
      const bytes = await this.fetchBytes(file);
      if (token !== this.token) return;
      const unchanged = this.lastBytes !== null && equalBytes(this.lastBytes, bytes);
      this.lastBytes = bytes;
      if (unchanged && this.state.kind === 'text') return;
      this.selection = NO_SELECTION;
      const diff = parseDiff(bytes)[0];
      if (!diff) this.state = { kind: 'empty' };
      else if (diff.isBinary) this.state = { kind: 'binary' };
      else if (diff.hunks.length === 0) this.state = { kind: 'empty' };
      else if (diffLineCount(diff) > LARGE_DIFF_LINES) this.state = { kind: 'tooLarge', diff };
      else this.state = { kind: 'text', presentation: buildPresentation(diff) };
    } catch (error) {
      if (token !== this.token) return;
      this.state = { kind: 'failed', message: friendlyError(error) };
    }
  }

  private async loadConflict(file: OpenFile, token: number): Promise<void> {
    const entry = this.host.status.conflicts.find((candidate) => candidate.path === file.change.path);
    if (!entry) {
      this.close();
      return;
    }
    try {
      if (!conflictHasMarkers(entry.kind)) {
        this.state = { kind: 'conflictWhole', entry, reason: 'no-markers' };
        return;
      }
      const bytes = await this.host.git.readWorkingFile(entry.path);
      if (token !== this.token) return;
      if (bytes === null) {
        this.state = { kind: 'conflictWhole', entry, reason: 'no-markers' };
        return;
      }
      const unchanged = this.lastBytes !== null && equalBytes(this.lastBytes, bytes);
      this.lastBytes = bytes;
      // Reloaded to exactly the old content (the status changed for another reason): keep it, so the in-progress selection is not lost.
      if (unchanged && this.state.kind === 'conflict') return;
      const parsed = parseConflictFile(bytes);
      if (!parsed.ok) {
        this.state = { kind: 'conflictWhole', entry, reason: 'not-utf8' };
        return;
      }
      if (parsed.file.blocks.length === 0) {
        this.state = { kind: 'conflictWhole', entry, reason: 'no-markers' };
        return;
      }
      const sha256 = await sha256Hex(bytes);
      if (token !== this.token) return;
      this.state = { kind: 'conflict', entry, file: parsed.file, sha256 };
    } catch (error) {
      if (token !== this.token) return;
      this.state = { kind: 'failed', message: friendlyError(error) };
    }
  }

  private async fetchBytes(file: OpenFile): Promise<Uint8Array> {
    const git = this.host.git;
    const context = this.host.diffContext();
    const ignoreWhitespace = this.host.diffIgnoreWhitespace();
    const source = file.source;
    switch (source.kind) {
      case 'unstaged':
        return git.workingDiffBytes(
          file.change,
          file.change.kind === 'untracked' ? 'untracked' : 'unstaged',
          context,
          ignoreWhitespace,
        );
      case 'staged':
        return git.workingDiffBytes(file.change, 'staged', context, ignoreWhitespace);
      case 'commit':
        return git.commitDiffBytes(source.sha, source.parent, file.change, context, ignoreWhitespace);
      case 'stash': {
        const stash = this.host.stashes.find((candidate) => candidate.sha === source.sha);
        if (!stash) throw new Error('Stash không còn tồn tại');
        return git.stashDiffBytes(stash, file.change, context, ignoreWhitespace);
      }
      case 'conflict':
        throw new Error('Xung đột được nạp riêng (loadConflict)');
    }
  }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
}
