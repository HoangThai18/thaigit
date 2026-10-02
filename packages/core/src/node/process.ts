// Chạy tiến trình git trên Node (mức thấp, KHÔNG kiểm chính sách — chỉ `NodeExec` và các lệnh có kiểu được gọi trực tiếp,
// mỗi nơi tự kiểm đầu vào). Spawn bằng mảng đối số (không qua shell), stdin là byte, stdout/stderr đọc song song.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { buildGitEnv, type EnvProfile } from '@thaigit/contracts';
import { concatBytes } from '../git/bytes.ts';
import { AdapterError } from '../git/runner.ts';

/** Cấu hình chung cho mọi adapter Node. */
export interface NodeGitConfig {
  /** Đường dẫn git (mặc định "git" trong PATH). */
  gitPath?: string;
  /** Môi trường gốc (mặc định `process.env`). Test cô lập cấu hình bằng cách đặt `GIT_CONFIG_GLOBAL`… ở đây. */
  baseEnv?: Readonly<Record<string, string | undefined>>;
  /** Lệnh askpass cho hồ sơ `interactive` (mặc định: không đặt, giữ nguyên biến của môi trường gốc). */
  askpass?: string;
  /** Lệnh askpass "từ chối" cho hồ sơ `background` (mặc định `false`: mọi lời hỏi đều thất bại thay vì treo/bật cửa sổ). */
  askpassDeny?: string;
  /** Thời gian chờ SIGTERM trước khi SIGKILL khi huỷ (mặc định 3000 ms). */
  killGraceMs?: number;
}

export interface SpawnGitOptions extends NodeGitConfig {
  /** Đối số đầy đủ gồm cả cờ `-c` (đã qua `buildGitArgv`). */
  argv: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  stdin?: Uint8Array;
  /** Chỉ lệnh `network` huỷ được. */
  cancellable: boolean;
  signal?: AbortSignal;
  /** Mỗi dòng stderr (tách theo `\r` hoặc `\n`, giữ byte, bỏ dòng rỗng). */
  onStderrLine?: (line: Uint8Array) => void;
}

export interface SpawnGitResult {
  code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
  cancelled: boolean;
}

const DEFAULT_KILL_GRACE_MS = 3000;

/** Env cho git từ cấu hình adapter (một chỗ duy nhất, dùng chung `buildGitEnv` của chính sách). */
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

/** Tách stderr thành dòng theo `\r` hoặc `\n` (git dùng `\r` để cập nhật dòng tiến độ). */
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

/** Bản sao thành `Uint8Array` thuần (không phải `Buffer` chia sẻ bộ nhớ với chunk của Node). */
function copyBytes(data: Uint8Array, start: number, end: number): Uint8Array {
  return new Uint8Array(data.subarray(start, end));
}

function exitCodeOf(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  // Bị tín hiệu giết: quy ước của shell là 128 + số tín hiệu (SIGTERM → 143).
  const number = signal === null ? undefined : osConstants.signals[signal];
  return 128 + (number ?? 0);
}

export function spawnGit(options: SpawnGitOptions): Promise<SpawnGitResult> {
  const { argv, cwd, env, stdin, signal, onStderrLine } = options;
  const cancellable = options.cancellable && signal !== undefined;
  const gitPath = options.gitPath ?? 'git';
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;

  return new Promise<SpawnGitResult>((resolve, reject) => {
    // Đã huỷ trước khi chạy: không spawn, báo huỷ (chưa có mã thoát thật nên dùng -1).
    if (cancellable && signal?.aborted) {
      resolve({ code: -1, stdout: new Uint8Array(0), stderr: new Uint8Array(0), cancelled: true });
      return;
    }

    // Lệnh mạng huỷ được chạy trong nhóm tiến trình riêng (POSIX) để huỷ giết luôn tiến trình con của git (ssh,
    // git-remote-*) thay vì để chúng mồ côi — cùng cách Rust làm (SIGTERM cả process group). Cũng nghĩa là ssh/git
    // không có terminal điều khiển nên không thể hỏi mật khẩu qua /dev/tty.
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
          // Nhóm đã hết thành viên: thử gửi thẳng tới tiến trình chính.
        }
      }
      child.kill(killSignal);
    };

    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    // Callback tiến trình ném lỗi không được làm sập tiến trình Node (lỗi trong event handler): giữ lỗi đầu tiên,
    // để git chạy nốt (không để lại tiến trình mồ côi) rồi báo lỗi đó cho người gọi.
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
        // ENOENT là "không tìm thấy git" — hoặc thư mục chạy không tồn tại (cũng báo ENOENT).
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
      // Git thoát sớm khi không cần hết stdin → EPIPE; kết quả vẫn lấy từ mã thoát, nên bỏ qua lỗi ghi.
      child.stdin.on('error', () => undefined);
      child.stdin.end(stdin);
    }
  });
}
