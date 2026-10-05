import type { RebaseResult, RebaseStepRequest } from '@thaigit/contracts';

/**
 * Typed git commands — they do not go through `Exec.run` because the validator blocks them (arbitrary config writes,
 * remote URLs as a command-execution vector, interactive rebase needing a sequence editor). In Rust:
 * `git_config_set` (key in `configSetAllowlist`), `git_remote_add` / `git_remote_set_url` (validated URL),
 * `git_rebase_interactive` (structured plan, Rust composes the todo file).
 */
export interface TypedGit {
  configSet(key: string, value: string, scope: 'local' | 'global'): Promise<void>;
  remoteAdd(name: string, url: string): Promise<void>;
  remoteSetUrl(name: string, url: string): Promise<void>;
  /**
   * Add a worktree under `<destToken>/<name>` (the token comes from a folder-picking dialog). `createBranch`: create a new
   * branch `branch` from `start` (null = HEAD); otherwise check out the existing branch. Returns the new worktree path.
   */
  worktreeAdd(
    destToken: string,
    name: string,
    branch: string,
    createBranch: boolean,
    start: string | null,
  ): Promise<string>;
  /** `git rebase -i --autostash <onto>` following the plan; a non-zero exit code is returned (not thrown) so the caller can build a `GitError`. */
  rebaseInteractive(onto: string, steps: readonly RebaseStepRequest[]): Promise<RebaseResult>;
}
