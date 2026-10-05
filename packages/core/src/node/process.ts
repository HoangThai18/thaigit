// Low-level git process execution on Node — does NOT enforce policy (only `NodeExec` and the typed commands call it
// directly, each validating its own input). Spawned with an argv array (never a shell), stdin is bytes, stdout and
// stderr are read concurrently.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { buildGitEnv, type EnvProfile } from '@thaigit/contracts';
import { concatBytes } from '../git/bytes.ts';
import { AdapterError } from '../git/runner.ts';

/** Config shared by every Node adapter. */
export interface NodeGitConfig {
  /** Path to git (default "git" from PATH). */
  gitPath?: string;
  /** Base environment (default `process.env`). Tests isolate git config by setting `GIT_CONFIG_GLOBAL`… here. */
  baseEnv?: Readonly<Record<string, string | undefined>>;
  /** Askpass command for the `interactive` profile (default: unset, keeping the base environment's variables). */
  askpass?: string;
  /** "Deny" askpass command for the `background` profile (default `false`: every prompt fails instead of hanging or popping a window). */
  askpassDeny?: string;
  /** Grace period between SIGTERM and SIGKILL when cancelling (default 3000 ms). */
  killGraceMs?: number;
}

export interface SpawnGitOptions extends NodeGitConfig {
  /** Full argv including the `-c` flags (already passed through `buildGitArgv`). */
  argv: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  stdin?: Uint8Array;
  /** Only `network` commands are cancellable. */
  cancellable: boolean;
  signal?: AbortSignal;
  /** Each stderr line (split on `\r` or `\n`, bytes preserved, empty lines dropped). */
  onStderrLine?: (line: Uint8Array) => void;
}

export interface SpawnGitResult {
  code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
  cancelled: boolean;
}

const DEFAULT_KILL_GRACE_MS = 3000;

/** Git environment built from the adapter config (the single place, sharing the policy's `buildGitEnv`). */
export function gitEnvFor(
  config: NodeGitConfig,
  profile: EnvProfile,
  callerEnv: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return buildGitEnv(config.baseEnv ?? process.env, {
    profile,
    callerEnv,
    ...(config.askpass !== undefined ? { askpass: config.askpass } : {}),
    askpassDeny: config.askpassDeny ?? 'false',
  });
}

/** Split stderr into lines on `\r` or `\n` (git uses `\r` to redraw the progress line). */
class StderrLineSplitter {
  private pending: Uint8Array = new Uint8Array(0);

  constructor(private readonly onLine: (line: Uint8Array) => void) {}

  push(chunk: Uint8Array): void {
    const data = this.pending.length === 0 ? chunk : concatBytes([this.pending, chunk]);
    let start = 0;
    for (let index = 0; index < data.length; index++) {
      const byte = data[index];
      if (byte !== 0x0a && byte !== 0x0d) continue;
      if (index > start) this.onLine(copyBytes(data, start, index));
      start = index + 1;
    }
    this.pending = copyBytes(data, start, data.length);
  }

  flush(): void {
    if (this.pending.length > 0) this.onLine(this.pending);
    this.pending = new Uint8Array(0);
  }
}

/** Plain `Uint8Array` copy (not a `Buffer`, which may share memory with a Node chunk). */
function copyBytes(data: Uint8Array, start: number, end: number): Uint8Array {
  return new Uint8Array(data.subarray(start, end));
}

function exitCodeOf(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  // Killed by a signal: the shell convention is 128 + signal number (SIGTERM → 143).
  const number = signal === null ? undefined : osConstants.signals[signal];
  return 128 + (number ?? 0);
}

export function spawnGit(options: SpawnGitOptions): Promise<SpawnGitResult> {
  const { argv, cwd, env, stdin, signal, onStderrLine } = options;
  const cancellable = options.cancellable && signal !== undefined;
  const gitPath = options.gitPath ?? 'git';
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;

  return new Promise<SpawnGitResult>((resolve, reject) => {
    // Cancelled before it ran: never spawn, report cancellation (there is no real exit code yet, so -1).
    if (cancellable && signal?.aborted) {
      resolve({ code: -1, stdout: new Uint8Array(0), stderr: new Uint8Array(0), cancelled: true });
      return;
    }

    // A cancellable network command runs in its own process group (POSIX) so cancelling also kills git's children
    // (ssh, git-remote-*) instead of orphaning them — same approach as Rust (SIGTERM the whole process group). This
    // also means ssh/git have no controlling terminal, so they cannot prompt for a password on /dev/tty.
    const ownGroup = cancellable && process.platform !== 'win32';
    const child = spawn(gitPath, [...argv], {
      cwd,
      env: { ...env },
      stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: ownGroup,
    });
    const kill = (killSignal: NodeJS.Signals) => {
      if (ownGroup && child.pid !== undefined) {
        try {
          process.kill(-child.pid, killSignal);
          return;
        } catch {
          // Group has no members left: try signalling the main process directly.
        }
      }
      child.kill(killSignal);
    };

    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    // An error thrown from the process callback must not crash Node (an error inside an event handler): keep the first
    // error, let git finish (so no process is left orphaned), then rethrow it to the caller.
    let callbackError: { error: unknown } | undefined;
    const splitter = onStderrLine
      ? new StderrLineSplitter((line) => {
          try {
            onStderrLine(line);
          } catch (error) {
            callbackError ??= { error };
          }
        })
      : undefined;
    let settled = false;
    let exited = false;
    let cancelled = false;
    let killTimer: NodeJS.Timeout | undefined;

    const onAbort = () => {
      if (exited || cancelled) return;
      cancelled = true;
      kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (!exited) kill('SIGKILL');
      }, killGraceMs);
      killTimer.unref();
    };
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      if (killTimer) clearTimeout(killTimer);
    };
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };

    if (cancellable) signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Uint8Array) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Uint8Array) => {
      stderrChunks.push(chunk);
      splitter?.push(chunk);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(() => {
        // ENOENT means "git not found" — or a missing working directory (also reported as ENOENT).
        if (error.code === 'ENOENT' && !existsSync(cwd)) {
          reject(new AdapterError('not-found', `Thư mục chạy git không tồn tại: ${cwd}`));
        } else {
          reject(
            new AdapterError(
              error.code === 'ENOENT' ? 'git-missing' : 'io',
              `Không chạy được ${gitPath}: ${error.message}`,
            ),
          );
        }
      });
    });
    child.on('close', (code, closeSignal) => {
      exited = true;
      splitter?.flush();
      finish(() => {
        if (callbackError) reject(callbackError.error);
        else
          resolve({
            code: exitCodeOf(code, closeSignal),
            stdout: concatBytes(stdoutChunks),
            stderr: concatBytes(stderrChunks),
            cancelled,
          });
      });
    });

    if (stdin && child.stdin) {
      // Git exits early when it does not need all of stdin → EPIPE; the result still comes from the exit code, so ignore write errors.
      child.stdin.on('error', () => undefined);
      child.stdin.end(stdin);
    }
  });
}
