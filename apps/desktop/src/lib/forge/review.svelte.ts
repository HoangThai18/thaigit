/**
 * Review một Pull Request / Merge Request (panel bên phải, thay chi tiết khi mở): mô tả của PR và các file thay đổi so với
 * điểm tách khỏi nhánh đích — đúng "Files changed" của GitHub / GitLab. Bấm file để xem diff của riêng file đó ở vùng giữa.
 *
 * Store chỉ giữ trạng thái; việc lấy nhánh về máy và tính danh sách file nằm ở `openReview.ts` (chạy qua hàng đợi thao tác của repo).
 */
import type { ForgeMergeRequest, ForgeProvider } from '@thaigit/contracts';
import type { FileChange } from '@thaigit/core';
import type { DiffSource, DiffStore } from '../stores/diff.svelte.ts';

/** Phần của `RepoStore` mà review cần (tránh import vòng). */
export interface ReviewHost {
  readonly diff: DiffStore;
  /** Các panel cùng chỗ bên phải: mở review thì đóng Dòng thời gian / Lịch sử file. */
  closeTimeline(): void;
  closeFileHistory(): void;
}

/** Thay đổi của PR: từ điểm tách (`from`) tới đầu nhánh của PR (`head`). */
export interface ReviewChanges {
  readonly head: string;
  readonly from: string;
  readonly files: readonly FileChange[];
}

export type ReviewPhase = 'loading' | 'ready' | 'failed';

export class ReviewStore {
  /** PR đang review; `null` = panel đóng. */
  request = $state.raw<ForgeMergeRequest | null>(null);
  /** Loại máy chủ của repo (đổi cách gọi PR / MR). */
  provider = $state<ForgeProvider | null>(null);
  phase = $state<ReviewPhase>('loading');
  changes = $state.raw<ReviewChanges | null>(null);
  /** Mỗi lần mở / đóng / tải lại tăng một bậc: kết quả của lần cũ về muộn thì bị bỏ. */
  private token = 0;

  constructor(private readonly host: ReviewHost) {}

  get isOpen(): boolean {
    return this.request !== null;
  }

  /** Bắt đầu (hoặc tải lại) review `request`: trả mã lần này để `finish` / `fail` nhận ra kết quả của chính nó. */
  begin(request: ForgeMergeRequest, provider: ForgeProvider | null): number {
    this.host.closeTimeline();
    this.host.closeFileHistory();
    const same =
      this.request !== null && this.request.host === request.host && this.request.number === request.number;
    if (!same) this.dropOpenDiff();
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
  }

  /** Đường dẫn file của PR đang mở diff (tô hàng trong danh sách), nếu có. */
  get openPath(): string | null {
    const changes = this.changes;
    const open = this.host.diff.file;
    if (changes === null || open === null || open.source.kind !== 'commit') return null;
    return open.source.sha === changes.head && open.source.parent === changes.from ? open.change.path : null;
  }

  /** Nguồn diff của PR (đầu nhánh so với điểm tách); `label` là chữ nhận diện ở đầu diff (vd. `#12`). */
  diffSource(label: string): DiffSource | null {
    const changes = this.changes;
    return changes === null ? null : { kind: 'commit', sha: changes.head, parent: changes.from, label };
  }

  /** Mở diff của một file trong PR ở vùng giữa. */
  openFile(change: FileChange, label: string): void {
    const source = this.diffSource(label);
    if (source !== null) this.host.diff.open(change, source);
  }

  /** Đóng panel thì đóng luôn diff của PR (diff của commit khác giữ nguyên). */
  private dropOpenDiff(): void {
    const changes = this.changes;
    const open = this.host.diff.file;
    if (changes === null || open === null || open.source.kind !== 'commit') return;
    if (open.source.sha === changes.head && open.source.parent === changes.from) this.host.diff.close();
  }
}
