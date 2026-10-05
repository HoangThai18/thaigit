/**
 * The interactive rebase plan being edited ("Interactive rebase" dialog, like GitKraken). `steps` is ordered
 * old → new (the order git applies them); the dialog shows the reverse (newest on top, matching the graph),
 * so every index here is a DISPLAY index.
 */
import {
  rebasePlanProblem,
  type Commit,
  type RebaseAction,
  type RebasePlanProblem,
  type RebaseStep,
} from '@thaigit/core';

export class RebaseSession {
  /** The base commit: the commits AFTER it (up to HEAD) get rewritten. */
  readonly base: Commit;
  readonly branch: string;
  /** The original commits, old → new. */
  readonly original: readonly Commit[];
  steps = $state.raw<readonly RebaseStep[]>([]);
  /** Full message of each commit (to prefill the reword box). */
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

  /** New → old (display order). */
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

  /** Move row `from` to position `to` (display index). */
  move(from: number, to: number): void {
    const rows = [...this.rows];
    if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return;
    const [moved] = rows.splice(from, 1);
    if (!moved) return;
    rows.splice(to, 0, moved);
    this.steps = rows.reverse();
  }

  /** Pre-fill the reword box with a commit's full message (only while the user hasn't typed). */
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

/** The open interactive rebase dialog (one repo per window, so a single session is enough). */
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
