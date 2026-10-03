// File đang mở ở vùng giữa (thay graph, như DiffPane của app Swift): nguồn diff, nội dung đã dựng sẵn để vẽ, và các dòng
// người dùng đang chọn để stage / bỏ stage / huỷ từng dòng. Diff luôn lấy dạng BYTE rồi parse ở core — patch dựng lại từ
// đó áp được đúng từng byte (CRLF, BOM, bảng mã khác UTF-8).

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
  | { readonly kind: 'commit'; readonly sha: string; readonly parent: string | null }
  | { readonly kind: 'stash'; readonly sha: string }
  /** File đang xung đột: mở trình giải xung đột thay vì diff. */
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
  /** `message`: câu thân thiện (errors/friendly.ts), không phải lỗi thô. */
  | { readonly kind: 'failed'; readonly message: string }
  /** File xung đột có dấu <<<<<<< (giải từng đoạn được); `sha256` của byte đã đọc để ghi lại có kiểm tra. */
  | {
      readonly kind: 'conflict';
      readonly entry: ConflictEntry;
      readonly file: ConflictFile;
      readonly sha256: string;
    }
  /** Xung đột không giải từng đoạn được (xoá ở một phía, không phải UTF-8, không thấy dấu): chỉ chọn cả file. */
  | {
      readonly kind: 'conflictWhole';
      readonly entry: ConflictEntry;
      readonly reason: 'no-markers' | 'not-utf8';
    };

/** Quá số dòng này thì hỏi trước khi vẽ (Swift: 20 000). */
export const LARGE_DIFF_LINES = 20_000;

export type LineSelection = ReadonlyMap<number, ReadonlySet<number>>;

const NO_SELECTION: LineSelection = new Map();

/** Những gì kho diff cần từ kho repo (tách ra để test được không cần cả RepoStore). */
export interface DiffHost {
  readonly git: GitRepository;
  readonly status: WorkingTreeStatus;
  readonly stashes: readonly Stash[];
  diffContext(): number;
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
  /** id hunk → chỉ số dòng (trong `hunk.lines`) đang chọn. */
  selection = $state.raw<LineSelection>(NO_SELECTION);

  private readonly host: DiffHost;
  private token = 0;
  /** Byte diff lần nạp gần nhất: nạp lại ra đúng byte cũ thì giữ nguyên lựa chọn dòng. */
  private lastBytes: Uint8Array | null = null;
  /** Vị trí của file đang mở trong danh sách của nó: file biến mất (đã stage, đã huỷ…) thì mở file đứng ở chỗ này. */
  private position = 0;

  constructor(host: DiffHost) {
    this.host = host;
  }

  get selectedCount(): number {
    let count = 0;
    for (const lines of this.selection.values()) count += lines.size;
    return count;
  }

  /** Diff đang hiển thị (đã parse), nếu có. */
  get fileDiff(): FileDiff | null {
    return this.state.kind === 'text' ? this.state.presentation.diff : null;
  }

  /** Danh sách chứa file đang mở (chưa stage / đã stage / xung đột) — `null` với diff của commit, stash. */
  get siblings(): readonly FileChange[] | null {
    return this.file ? this.listFor(this.file.source) : null;
  }

  /** Stage / bỏ stage / huỷ từng hunk hoặc dòng được không (file thường, không nhị phân, không phải chỉ đổi quyền). */
  get supportsPartial(): boolean {
    const diff = this.fileDiff;
    return diff !== null && supportsPartialStaging(diff);
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
   * File kế (`step` = 1) / trước (−1) trong cùng danh sách với file đang mở (chưa stage, đã stage, xung đột). Hết danh sách thì
   * đứng yên. Trả `false` khi không đổi được.
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

  /** Vẫn vẽ diff rất lớn (sau khi người dùng bấm "Vẫn hiển thị"). */
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
   * Gọi sau khi status đổi: file đang mở (thay đổi chưa commit) vẫn còn thì nạp lại diff; không còn trong danh sách (đã stage
   * hết, đã huỷ, đã commit) thì đóng.
   */
  statusDidChange(): void {
    const file = this.file;
    if (!file) return;
    const list = this.listFor(file.source);
    if (!list) return;
    const index = list.findIndex((change) => change.path === file.change.path);
    const current = list[index];
    if (!current) {
      // File vừa stage / bỏ stage / huỷ / giải xong: mở file đứng ở đúng chỗ đó trong danh sách (như GitHub Desktop) để duyệt
      // tiếp không phải bấm lại; danh sách đã trống thì đóng, quay về graph.
      const next = list[Math.min(this.position, list.length - 1)];
      if (next) this.open(next, file.source);
      else this.close();
      return;
    }
    this.position = index;
    if (file.source.kind === 'conflict') {
      // File xung đột có thể vừa đổi trên đĩa: nạp lại (nội dung y nguyên thì `loadConflict` giữ lựa chọn đang làm dở).
      void this.load();
      return;
    }
    if (current.kind !== file.change.kind || current.oldPath !== file.change.oldPath) {
      this.file = { source: file.source, change: current };
    }
    void this.load();
  }

  /** Danh sách chứa file của `source` (thay đổi chưa commit, xung đột); `null` với diff của commit / stash. */
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

  /** Nạp lại diff của file đang mở. */
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
      // Nạp lại ra đúng nội dung cũ (status đổi vì lý do khác): giữ nguyên, khỏi mất các lựa chọn đang làm dở.
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
    const source = file.source;
    switch (source.kind) {
      case 'unstaged':
        return git.workingDiffBytes(
          file.change,
          file.change.kind === 'untracked' ? 'untracked' : 'unstaged',
          context,
        );
      case 'staged':
        return git.workingDiffBytes(file.change, 'staged', context);
      case 'commit':
        return git.commitDiffBytes(source.sha, source.parent, file.change, context);
      case 'stash': {
        const stash = this.host.stashes.find((candidate) => candidate.sha === source.sha);
        if (!stash) throw new Error('Stash không còn tồn tại');
        return git.stashDiffBytes(stash, file.change, context);
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
