// Runs git through the `Exec` port (port of GitRunner.swift): checks the exit code, records the log with credentials
// redacted, raises typed errors.
// Env and `-c` flags are NOT set here: the adapter (Rust in the app, Node in tests) applies them from `git-policy.json`.

import {
  effectiveKind,
  type CommandError,
  type EnvProfile,
  type ExecKind,
  type PolicyViolation,
} from '@thaigit/contracts';
import type { Exec, ExecResult } from '../ports/index.ts';
import { redactSecrets, type CommandLog } from '../support/command-log.ts';
import { decodeUtf8 } from './bytes.ts';

/** A git command returned an unexpected exit code. `args` includes the subcommand (`["fetch", "--all"]`) but not the global `-c` flags. */
export class GitError extends Error {
  readonly args: readonly string[];
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(args: readonly string[], exitCode: number, stdout: string, stderr: string) {
    super(gitErrorMessage(args, exitCode, stdout, stderr));
    this.name = 'GitError';
    this.args = args;
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }

  /** Command line for display; credentials already redacted. */
  get commandLine(): string {
    return redactSecrets(`git ${this.args.join(' ')}`);
  }

  /** All output, used to recognise the familiar errors. */
  get combinedOutput(): string {
    return `${this.stderr}\n${this.stdout}`;
  }

  /** Does the output contain `needle` (case-insensitive)? */
  contains(needle: string): boolean {
    return this.combinedOutput.toLowerCase().includes(needle.toLowerCase());
  }
}

/** Same rule as Swift's `GitError.message`: stderr is the message; append stdout when short; otherwise report the exit code. */
function gitErrorMessage(args: readonly string[], exitCode: number, stdout: string, stderr: string): string {
  const err = stderr.trim();
  const out = stdout.trim();
  if (err !== '' && out !== '' && exitCode !== 0 && out.length < 2000) return `${out}\n${err}`;
  if (err !== '') return err;
  if (out !== '') return out;
  return `Lệnh git ${args[0] ?? ''} thất bại (mã thoát ${exitCode}).`;
}

/** A network operation the user cancelled. Always carries git's real exit code so we know how far it got (the result is not hidden). */
export class CancelledError extends Error {
  readonly exitCode: number;

  constructor(exitCode: number) {
    super('Đã huỷ thao tác.');
    this.name = 'CancelledError';
    this.exitCode = exitCode;
  }
}

/**
 * An error reported by the adapter (Rust/Node), sharing its codes with IPC's `CommandError`: `policy` (command blocked
 * by policy), `out-of-scope`, `conflict` (CAS), `not-found`, `io`…. Distinct from `GitError` (git ran but returned an
 * unacceptable exit code).
 */
export class AdapterError extends Error implements CommandError {
  readonly code: CommandError['code'];
  /** Present only when `code === 'policy'` and the violation came from a TS-side checker. */
  readonly violation?: PolicyViolation;

  constructor(code: CommandError['code'], message: string, violation?: PolicyViolation) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
    if (violation) this.violation = violation;
  }
}

export interface RunOptions {
  /** Acceptable exit codes (default `[0]`), e.g. `[0, 1]` for `diff --no-index`, `config --get`. */
  acceptExitCodes?: readonly number[];
  stdin?: Uint8Array;
  /** Only keys listed in the policy's `env.fromCaller` (`GIT_OPTIONAL_LOCKS=0`, `GIT_LITERAL_PATHSPECS=1`…). */
  env?: Readonly<Record<string, string>>;
  profile?: EnvProfile;
  /** Each stderr line with leading/trailing whitespace trimmed (clone/fetch/push progress); empty lines dropped. */
  onProgress?: (line: string) => void;
  /** Only `network` commands are cancellable. */
  signal?: AbortSignal;
}

export interface RunOutput {
  code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

/**
 * Command kind per `git-policy.json` (the source of truth for per-repo locking and cancellation). Pass `args` so the
 * read-only shapes of a `write` subcommand are recognised (`stash list`, `remote -v`…; matched against the WHOLE args
 * shape, see `readForms` in the policy): they need no exclusive lock, so a refresh does not queue behind a long
 * fetch/pull. Without `args` only the subcommand is considered; an unknown subcommand counts as `write` (tightest lock).
 */
export function execKindOf(sub: string, args: readonly string[] = []): ExecKind {
  return effectiveKind(sub, args) ?? 'write';
}

export class GitRunner {
  constructor(
    readonly exec: Exec,
    readonly log?: CommandLog,
  ) {}

  /**
   * Run `git <sub> <args…>`. The lock kind comes from the policy by subcommand. Cancelling →
   * `CancelledError(realExitCode)`; an exit code outside `acceptExitCodes` → `GitError`. Adapter errors (policy block,
   * git could not be spawned) are logged and rethrown.
   */
  async run(sub: string, args: readonly string[], options: RunOptions = {}): Promise<RunOutput> {
    const { acceptExitCodes = [0], onProgress } = options;
    const startedAt = Date.now();
    const argv = [sub, ...args];
    let result: ExecResult;
    try {
      result = await this.exec.run({
        kind: execKindOf(sub, args),
        sub,
        args,
        stdin: options.stdin,
        env: options.env,
        profile: options.profile,
        signal: options.signal,
        onStderrLine: onProgress
          ? (line) => {
              const text = decodeUtf8(line).trim();
              if (text !== '') onProgress(text);
            }
          : undefined,
      });
    } catch (error) {
      this.log?.record({
        args: argv,
        startedAt,
        durationMs: Date.now() - startedAt,
        exitCode: -1,
        cancelled: false,
        stderr: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    this.log?.record({
      args: argv,
      startedAt,
      durationMs: Date.now() - startedAt,
      exitCode: result.code,
      cancelled: result.cancelled,
      stderr: decodeUtf8(result.stderr),
    });
    // Cancelled: report cancellation instead of a git error (exit code 143 from SIGTERM), but keep the real code.
    if (result.cancelled) throw new CancelledError(result.code);
    if (!acceptExitCodes.includes(result.code)) {
      throw new GitError(argv, result.code, decodeUtf8(result.stdout), decodeUtf8(result.stderr));
    }
    return { code: result.code, stdout: result.stdout, stderr: result.stderr };
  }

  /** Like Swift's `output`: stdout decoded as UTF-8. */
  async text(sub: string, args: readonly string[], options: RunOptions = {}): Promise<string> {
    return decodeUtf8((await this.run(sub, args, options)).stdout);
  }
}
