import { Channel } from '@tauri-apps/api/core';
import { Commands, FrameTag, type ExitFrame, type GitExecRequest, decodeExitFrame } from '@thaigit/contracts';
import type { ExecRequest, ExecResult } from '@thaigit/core';
import { CommandFailure, toCommandFailure } from './errors.ts';
import { call } from './invoke.ts';

/** `Channel<ArrayBuffer>` message: a `Raw` arrives as an `ArrayBuffer` (true for both the small eval path and the large fetch path). */
export type RawFrame = ArrayBuffer | ArrayBufferView | readonly number[];

/**
 * Treat a missing `exit` frame after `invoke` resolved as a protocol error (Rust always sends it BEFORE
 * the command returns). The legitimate exception is a command Rust killed for exceeding the output cap
 * (256 MiB): `invoke` then REJECTS with code `io` and no `exit` frame ever arrives.
 */
export const EXIT_FRAME_GRACE_MS = 10_000;

export function toBytes(frame: RawFrame): Uint8Array {
  if (frame instanceof ArrayBuffer) return new Uint8Array(frame);
  if (ArrayBuffer.isView(frame)) return new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
  return Uint8Array.from(frame);
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Reassemble the `[tag|bytes]` frames of `git_exec`: tag 1 = a stdout chunk (concatenate in arrival
 * order), tag 2 = one stderr line (no separator included, bytes kept verbatim), tag 3 = exit (i32 LE +
 * cancelled), always the final frame. Only the exit frame ends the call — the `invoke` promise can
 * resolve before the last chunks arrive.
 */
export class FrameCollector {
  private readonly stdout: Uint8Array[] = [];
  private stdoutLength = 0;
  private readonly stderr: Uint8Array[] = [];
  private exitFrame: ExitFrame | null = null;

  constructor(private readonly onStderrLine?: (line: Uint8Array) => void) {}

  get exit(): ExitFrame | null {
    return this.exitFrame;
  }

  push(frame: RawFrame): void {
    const bytes = toBytes(frame);
    const tag = bytes[0];
    if (tag === undefined) throw new CommandFailure('internal', 'Frame rỗng từ lõi Rust');
    if (this.exitFrame) throw new CommandFailure('internal', 'Nhận frame sau frame exit');
    switch (tag) {
      case FrameTag.Stdout: {
        const chunk = bytes.subarray(1);
        this.stdout.push(chunk);
        this.stdoutLength += chunk.length;
        return;
      }
      case FrameTag.StderrLine: {
        const line = bytes.subarray(1);
        this.stderr.push(line);
        try {
          this.onStderrLine?.(line);
        } catch {
          // A broken progress callback from the caller must not break the git command.
        }
        return;
      }
      case FrameTag.Exit:
        this.exitFrame = decodeExitFrame(bytes);
        return;
      default:
        throw new CommandFailure('internal', `Frame có tag lạ: ${tag}`);
    }
  }

  /** Result once `exit` has been received. stderr lines are concatenated, each terminated by `\n`. */
  result(): ExecResult {
    if (!this.exitFrame) throw new CommandFailure('internal', 'Chưa nhận frame exit');
    const stderrLines = this.stderr.map((line) => {
      const withNewline = new Uint8Array(line.length + 1);
      withNewline.set(line);
      withNewline[line.length] = 0x0a;
      return withNewline;
    });
    return {
      code: this.exitFrame.code,
      cancelled: this.exitFrame.cancelled,
      stdout: concat(this.stdout, this.stdoutLength),
      stderr: concat(
        stderrLines,
        stderrLines.reduce((sum, line) => sum + line.length, 0),
      ),
    };
  }
}

/** Base64 of bytes (`git_exec` stdin: patches, NUL-separated path lists — always small). */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/** Random `opId` (letters + digits + `-`, ≤ 64 chars); not `crypto.randomUUID` because old WKWebView (macOS 11) lacks it. */
export function newOpId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `op-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Cancellation that allows a retry: a cancelled command can reach Rust before its op is registered (returns `false`). */
async function cancelUntilAcknowledged(opId: string, isFinished: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20 && !isFinished(); attempt++) {
    try {
      if (await call<boolean>(Commands.gitCancel, { opId })) return;
    } catch {
      return;
    }
    await delay(50);
  }
}

/**
 * Run one git command inside an open repo. Rust enforces the policy, adds the `-c` flags and the standard
 * environment; here we only send `sub` + `args` (plus a few allowed env vars). Only `network` commands
 * can be cancelled via `signal` (soft → hard escalation); for every other kind `signal` is ignored.
 * Resolves only once the `exit` frame arrives.
 */
export async function runGit(repoId: string, request: ExecRequest): Promise<ExecResult> {
  if (request.signal?.aborted && request.kind === 'network') {
    return { code: -1, cancelled: true, stdout: new Uint8Array(0), stderr: new Uint8Array(0) };
  }
  const opId = newOpId();
  const body: GitExecRequest = {
    repoId,
    opId,
    kind: request.kind,
    sub: request.sub,
    args: [...request.args],
    stdin: request.stdin ? bytesToBase64(request.stdin) : undefined,
    env: request.env ? { ...request.env } : undefined,
    profile: request.profile,
  };
  const collector = new FrameCollector(request.onStderrLine);

  return new Promise<ExecResult>((resolve, reject) => {
    let finished = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let stopListening: (() => void) | undefined;
    const finish = (action: () => void): void => {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      stopListening?.();
      action();
    };

    const signal = request.signal;
    if (signal && request.kind === 'network') {
      const onAbort = (): void => void cancelUntilAcknowledged(opId, () => finished);
      signal.addEventListener('abort', onAbort, { once: true });
      stopListening = () => signal.removeEventListener('abort', onAbort);
    }

    const channel = new Channel<RawFrame>((frame) => {
      if (finished) return;
      try {
        collector.push(frame);
      } catch (error) {
        finish(() => reject(toCommandFailure(error)));
        return;
      }
      if (collector.exit) finish(() => resolve(collector.result()));
    });

    call<void>(Commands.gitExec, { req: body, channel }).then(
      () => {
        if (finished) return;
        watchdog = setTimeout(
          () =>
            finish(() =>
              reject(new CommandFailure('internal', 'Lõi Rust xong lệnh nhưng không gửi frame exit')),
            ),
          EXIT_FRAME_GRACE_MS,
        );
      },
      (error: unknown) => finish(() => reject(toCommandFailure(error))),
    );
  });
}
