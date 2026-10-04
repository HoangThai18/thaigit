// Rebase tương tác (port RebasePlan của GitRepository+Rebase.swift): kế hoạch xếp cũ → mới, mỗi commit một thao tác. Chỉ phần
// thuần (kiểm kế hoạch) ở đây — chạy thật là lệnh có kiểu `TypedGit.rebaseInteractive` (Rust tự soạn file todo).

import type { RebaseAction, RebaseStepRequest } from '@thaigit/contracts';
import { isMergeCommit, type Commit } from './models.ts';

export type { RebaseAction } from '@thaigit/contracts';

export const REBASE_ACTIONS: readonly RebaseAction[] = ['pick', 'reword', 'squash', 'fixup', 'drop'];

/** Một dòng của kế hoạch. */
export interface RebaseStep {
  readonly commit: Commit;
  readonly action: RebaseAction;
  /** Lời commit mới khi `action === 'reword'`. */
  readonly message?: string;
}

/** Lý do kế hoạch không chạy được (giao diện tự dịch ra câu). */
export type RebasePlanProblem =
  /** Không có commit nào để rebase. */
  | 'empty'
  /** Đoạn có commit merge — chưa hỗ trợ (git -i bỏ merge, làm phẳng lịch sử). */
  | 'merge'
  /** Commit cũ nhất còn lại là squash / fixup: không có gì phía trước để gộp vào. */
  | 'leadingSquash'
  /** Reword mà để trống message. */
  | 'emptyMessage'
  /** Bỏ hết mọi commit. */
  | 'allDropped'
  /** Giống hệt ban đầu. */
  | 'unchanged';

export function rebasePlanProblem(
  steps: readonly RebaseStep[],
  original: readonly Commit[],
): RebasePlanProblem | null {
  if (steps.length === 0) return 'empty';
  if (steps.some((step) => isMergeCommit(step.commit))) return 'merge';
  const kept = steps.filter((step) => step.action !== 'drop');
  if (kept.length === 0) return 'allDropped';
  const first = kept[0];
  if (first && (first.action === 'squash' || first.action === 'fixup')) return 'leadingSquash';
  if (steps.some((step) => step.action === 'reword' && (step.message ?? '').trim() === ''))
    return 'emptyMessage';
  const sameOrder =
    steps.length === original.length && steps.every((step, index) => step.commit.id === original[index]?.id);
  if (sameOrder && steps.every((step) => step.action === 'pick')) return 'unchanged';
  return null;
}

/** Kế hoạch dạng gửi qua IPC (chỉ sha + thao tác + message). */
export function rebaseRequest(steps: readonly RebaseStep[]): RebaseStepRequest[] {
  return steps.map((step) =>
    step.action === 'reword'
      ? { action: step.action, sha: step.commit.id, message: step.message ?? '' }
      : { action: step.action, sha: step.commit.id },
  );
}

/** Rebase xong nhưng trả lại thay đổi chưa commit (đã tự cất) bị xung đột — thay đổi vẫn nằm trong stash. */
export type InteractiveRebaseResult = 'done' | 'autostashConflict';
