import { Channel } from '@tauri-apps/api/core';
import { Commands, FrameTag, type ExitFrame, type GitExecRequest, decodeExitFrame } from '@thaigit/contracts';
import type { ExecRequest, ExecResult } from '@thaigit/core';
import { CommandFailure, toCommandFailure } from './errors.ts';
import { call } from './invoke.ts';

/** Thông điệp `Channel<ArrayBuffer>`: Raw tới dạng `ArrayBuffer` (đường eval nhỏ và đường fetch lớn đều vậy). */
export type RawFrame = ArrayBuffer | ArrayBufferView | readonly number[];

/**
 * Sau khi `invoke` xong mà frame `exit` chưa tới (Rust luôn gửi nó TRƯỚC khi lệnh trả về) thì coi là lỗi giao thức. Ngoại lệ hợp lệ
 * là lệnh bị Rust dừng vì output vượt giới hạn (256 MiB): khi đó `invoke` REJECT với mã `io` và không có frame `exit`.
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
 * Gom frame `[tag|bytes]` của `git_exec`: tag 1 = khối stdout (nối theo thứ tự nhận), tag 2 = một dòng stderr (không kèm
 * ký tự tách, giữ nguyên byte), tag 3 = exit (i32 LE + cancelled), luôn là frame cuối. Chỉ tin frame exit để kết thúc —
 * lời gọi `invoke` có thể resolve trước khi các khối cuối tới.
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
          // Callback tiến độ của người gọi hỏng không được làm hỏng lệnh git.
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

  /** Kết quả khi đã nhận exit. stderr nối các dòng, mỗi dòng kết thúc bằng `\n`. */
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

/** Base64 của byte (stdin của `git_exec`: patch, danh sách path ngăn bằng NUL — luôn nhỏ). */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/** `opId` ngẫu nhiên (chữ + số + `-`, ≤ 64 ký tự); không dùng `crypto.randomUUID` vì WKWebView cũ (macOS 11) chưa có. */
export function newOpId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `op-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Huỷ có thử lại: lệnh huỷ có thể tới Rust trước khi op kịp đăng ký (trả `false`). */
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
 * Chạy một lệnh git trong repo đã mở. Rust kiểm chính sách, thêm cờ `-c` và env chuẩn; ở đây chỉ gửi `sub` + `args`
 * (+ vài env được phép). Chỉ lệnh `network` huỷ được qua `signal` (huỷ theo bậc: mềm → cứng); với loại khác `signal` bị bỏ qua.
 * Resolve duy nhất khi nhận frame `exit`.
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
