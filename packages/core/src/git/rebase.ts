// Interactive rebase (port of RebasePlan in GitRepository+Rebase.swift): a plan ordered oldest → newest, one action per
// commit. Only the pure part (plan validation) lives here — actually running it is the typed command
// `TypedGit.rebaseInteractive` (Rust composes the todo file itself).

import type { RebaseAction, RebaseStepRequest } from '@thaigit/contracts';
import { isMergeCommit, type Commit } from './models.ts';

export type { RebaseAction } from '@thaigit/contracts';

export const REBASE_ACTIONS: readonly RebaseAction[] = ['pick', 'reword', 'squash', 'fixup', 'drop'];

/** One line of the plan. */
export interface RebaseStep {
  readonly commit: Commit;
  readonly action: RebaseAction;
  /** New commit message when `action === 'reword'`. */
  readonly message?: string;
}

/** Why the plan cannot run (the UI turns this into a sentence). */
export type RebasePlanProblem =
  /** No commits to rebase. */
  | 'empty'
  /** The range contains a merge commit — unsupported (`git rebase -i` drops merges, flattening history). */
  | 'merge'
  /** The oldest remaining commit is a squash / fixup: nothing before it to merge into. */
  | 'leadingSquash'
  /** A reword with an empty message. */
  | 'emptyMessage'
  /** Every commit is dropped. */
  | 'allDropped'
  /** Identical to the original. */
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

/** Plan in the shape sent over IPC (sha + action + message only). */
export function rebaseRequest(steps: readonly RebaseStep[]): RebaseStepRequest[] {
  return steps.map((step) =>
    step.action === 'reword'
      ? { action: step.action, sha: step.commit.id, message: step.message ?? '' }
      : { action: step.action, sha: step.commit.id },
  );
}

/** The rebase finished but the auto-stashed uncommitted changes conflicted — the changes are still in the stash. */
export type InteractiveRebaseResult = 'done' | 'autostashConflict';
