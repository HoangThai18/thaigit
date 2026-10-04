/**
 * Kế hoạch rebase tương tác đang soạn (hộp thoại "Rebase tương tác", như GitKraken). `steps` xếp cũ → mới (thứ tự git áp dụng);
 * hộp thoại hiện ngược lại (mới nhất trên cùng, khớp graph) nên mọi chỉ số ở đây là chỉ số HIỂN THỊ.
 */
import {
  rebasePlanProblem,
  type Commit,
  type RebaseAction,
  type RebasePlanProblem,
  type RebaseStep,
} from '@thaigit/core';

export class RebaseSession {
  /** Commit gốc: các commit SAU nó (tới HEAD) được viết lại. */
  readonly base: Commit;
  readonly branch: string;
  /** Các commit ban đầu, cũ → mới. */
  readonly original: readonly Commit[];
  steps = $state.raw<readonly RebaseStep[]>([]);
  /** Message đầy đủ của từng commit (để điền sẵn khi chọn reword). */
  private readonly fullMessages = new Map<string, string>();

  constructor(
    base: Commit,
    branch: string,
    original: readonly Commit[],
    private readonly loadMessage: (sha: string) => Promise<string>,
  ) {
    this.base = base;
    this.branch = branch;
    this.original = original;
    this.reset();
  }

  /** Mới → cũ (thứ tự hiển thị). */
  get rows(): readonly RebaseStep[] {
    return [...this.steps].reverse();
  }

  get problem(): RebasePlanProblem | null {
    return rebasePlanProblem(this.steps, this.original);
  }

  reset(): void {
    this.steps = this.original.map((commit) => ({ commit, action: 'pick' }));
  }

  private stepIndex(row: number): number {
    return this.steps.length - 1 - row;
  }

  private update(row: number, change: (step: RebaseStep) => RebaseStep): void {
    const index = this.stepIndex(row);
    const current = this.steps[index];
    if (!current) return;
    const next = [...this.steps];
    next[index] = change(current);
    this.steps = next;
  }

  setAction(row: number, action: RebaseAction): void {
    this.update(row, (step) => ({ ...step, action }));
    const step = this.steps[this.stepIndex(row)];
    if (action === 'reword' && step && step.message === undefined) void this.prefillMessage(step.commit);
  }

  setMessage(row: number, message: string): void {
    this.update(row, (step) => ({ ...step, message }));
  }

  /** Chuyển hàng `from` tới vị trí `to` (chỉ số hiển thị). */
  move(from: number, to: number): void {
    const rows = [...this.rows];
    if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return;
    const [moved] = rows.splice(from, 1);
    if (!moved) return;
    rows.splice(to, 0, moved);
    this.steps = rows.reverse();
  }

  /** Điền message đầy đủ của commit vào ô soạn của reword (nếu người dùng chưa gõ gì). */
  private async prefillMessage(commit: Commit): Promise<void> {
    let message = this.fullMessages.get(commit.id);
    if (message === undefined) {
      try {
        message = (await this.loadMessage(commit.id)).trim();
      } catch {
        message = commit.subject;
      }
      this.fullMessages.set(commit.id, message);
    }
    const index = this.steps.findIndex((step) => step.commit.id === commit.id);
    const step = this.steps[index];
    if (!step || step.message !== undefined) return;
    const next = [...this.steps];
    next[index] = { ...step, message };
    this.steps = next;
  }
}

/** Hộp thoại rebase tương tác đang mở (mỗi cửa sổ một repo, nên một phiên là đủ). */
class RebaseEditorStore {
  current = $state.raw<RebaseSession | null>(null);

  open(session: RebaseSession): void {
    this.current = session;
  }

  close(): void {
    this.current = null;
  }
}

export const rebaseEditor = new RebaseEditorStore();
