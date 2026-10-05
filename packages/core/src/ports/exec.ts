import type { EnvProfile, ExecKind } from '@thaigit/contracts';

/** A git command inside an already-open repository. `-c` flags, env scrubbing and policy checks are the adapter's job (Rust in the app). */
export interface ExecRequest {
  /** `read` does not lock the repo (status runs with GIT_OPTIONAL_LOCKS=0); `write`/`network` are exclusive per repo. */
  kind: ExecKind;
  /** Subcommand present in the git-policy.json allowlist. */
  sub: string;
  /** Free-form value (a message, a filename…) passed as `--opt=value`, via stdin, or after `--` — never split off behind a short flag. */
  args: readonly string[];
  stdin?: Uint8Array;
  /** Only keys listed in the policy's `env.fromCaller` (GIT_OPTIONAL_LOCKS, GIT_LITERAL_PATHSPECS, GIT_INDEX_FILE). */
  env?: Readonly<Record<string, string>>;
  /** Defaults to `interactive`; autofetch uses `background` (which never opens a sign-in dialog). */
  profile?: EnvProfile;
  /** Each stderr line (clone/fetch/push progress), bytes preserved. */
  onStderrLine?: (line: Uint8Array) => void;
  /** Only `network` commands are cancellable (cancelled in stages). */
  signal?: AbortSignal;
}

export interface ExecResult {
  code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
  /** Cancelled: the exit code is still kept, so we know how far git got. */
  cancelled: boolean;
}

/** Runs git inside an already-open repository: the Node adapter (tests) and the Tauri adapter (app). */
export interface Exec {
  run(request: ExecRequest): Promise<ExecResult>;
}
