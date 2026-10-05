/**
 * Risk flags on uncommitted changes (deletions / skipped tests, dependency changes, CI, large files,
 * secrets) — recomputed after each status refresh (close-together refreshes are batched), because an agent
 * can add a token line to a file that was already "modified" without the file list changing.
 * Advisory only: a failure to compute stays silent and never blocks a commit.
 */
import {
  collectRiskInputs,
  detectRisks,
  type GitRepository,
  type RiskFlag,
  type WorkingTreeStatus,
} from '@thaigit/core';
import { jsonEqual } from '../stores/equality.ts';

export interface RiskHost {
  readonly git: GitRepository;
  readonly status: WorkingTreeStatus;
}

export const RISK_DEBOUNCE_MS = 1500;

export class RiskStore {
  flags = $state.raw<readonly RiskFlag[]>([]);
  /** The set of flags the user dismissed: the warning strip only reappears for a new flag. */
  dismissedKey = $state('');

  get key(): string {
    return JSON.stringify(this.flags);
  }

  get visible(): readonly RiskFlag[] {
    return this.flags.length > 0 && this.key !== this.dismissedKey ? this.flags : [];
  }

  dismiss(): void {
    this.dismissedKey = this.key;
  }
  private timer: ReturnType<typeof setTimeout> | undefined;
  private token = 0;
  private disposed = false;

  constructor(
    private readonly host: RiskHost,
    private readonly delayMs = RISK_DEBOUNCE_MS,
  ) {}

  /** The just-refreshed status: recomputed after a debounce. */
  schedule(): void {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), this.delayMs);
  }

  async refresh(): Promise<void> {
    const token = ++this.token;
    try {
      const flags = detectRisks(await collectRiskInputs(this.host.git, this.host.status));
      if (token !== this.token || this.disposed) return;
      if (!jsonEqual(flags, this.flags)) this.flags = flags;
    } catch {
      // Flags are only advisory: if the repo is busy or a command fails, keep the previous result and recompute on the next refresh.
    }
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}
