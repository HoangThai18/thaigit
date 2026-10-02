// Chạy git qua port `Exec` (port GitRunner.swift): kiểm mã thoát, ghi nhật ký đã che credential, lỗi có kiểu.
// Env và cờ `-c` KHÔNG viết ở đây: adapter (Rust trong app, Node trong test) áp từ `git-policy.json`.

import {
  gitPolicy,
  type CommandError,
  type EnvProfile,
  type ExecKind,
  type PolicyViolation,
} from '@thaigit/contracts';
import type { Exec, ExecResult } from '../ports/index.ts';
import { redactSecrets, type CommandLog } from '../support/command-log.ts';
import { decodeUtf8 } from './bytes.ts';

/** Lỗi khi lệnh git trả mã thoát không mong đợi. `args` gồm cả subcommand (`["fetch", "--all"]`), không gồm cờ `-c` toàn cục. */
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

  /** Dòng lệnh để hiển thị; đã che credential. */
  get commandLine(): string {
    return redactSecrets(`git ${this.args.join(' ')}`);
  }

  /** Toàn bộ output, dùng để nhận diện các lỗi quen thuộc. */
  get combinedOutput(): string {
    return `${this.stderr}\n${this.stdout}`;
  }

  /** Output có chứa `needle` không (không phân biệt hoa thường). */
  contains(needle: string): boolean {
    return this.combinedOutput.toLowerCase().includes(needle.toLowerCase());
  }
}

/** Cùng luật với `GitError.message` của Swift: stderr là chính; ghép stdout nếu ngắn; không có gì thì nêu mã thoát. */
function gitErrorMessage(args: readonly string[], exitCode: number, stdout: string, stderr: string): string {
  const err = stderr.trim();
  const out = stdout.trim();
  if (err !== '' && out !== '' && exitCode !== 0 && out.length < 2000) return `${out}\n${err}`;
  if (err !== '') return err;
  if (out !== '') return out;
  return `Lệnh git ${args[0] ?? ''} thất bại (mã thoát ${exitCode}).`;
}

/** Thao tác mạng bị người dùng huỷ. Luôn mang mã thoát thật của git để biết nó đã làm tới đâu (không che kết quả). */
export class CancelledError extends Error {
  readonly exitCode: number;

  constructor(exitCode: number) {
    super('Đã huỷ thao tác.');
    this.name = 'CancelledError';
    this.exitCode = exitCode;
  }
}

/**
 * Lỗi do bộ chuyển (Rust/Node) báo, cùng mã với `CommandError` của IPC: `policy` (lệnh bị chính sách chặn),
 * `out-of-scope`, `conflict` (CAS), `not-found`, `io`…. Khác `GitError` (git chạy xong nhưng mã thoát ≠ chấp nhận).
 */
export class AdapterError extends Error implements CommandError {
  readonly code: CommandError['code'];
  /** Chỉ có khi `code === 'policy'` và vi phạm đến từ bộ kiểm tra của TS. */
  readonly violation?: PolicyViolation;

  constructor(code: CommandError['code'], message: string, violation?: PolicyViolation) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
    if (violation) this.violation = violation;
  }
}

export interface RunOptions {
  /** Mã thoát chấp nhận được (mặc định `[0]`), ví dụ `[0, 1]` cho `diff --no-index`, `config --get`. */
  acceptExitCodes?: readonly number[];
  stdin?: Uint8Array;
  /** Chỉ khoá trong `env.fromCaller` của chính sách (`GIT_OPTIONAL_LOCKS=0`, `GIT_LITERAL_PATHSPECS=1`…). */
  env?: Readonly<Record<string, string>>;
  profile?: EnvProfile;
  /** Mỗi dòng stderr đã bỏ khoảng trắng đầu/cuối (tiến trình clone/fetch/push); dòng rỗng bị bỏ. */
  onProgress?: (line: string) => void;
  /** Chỉ lệnh `network` huỷ được. */
  signal?: AbortSignal;
}

export interface RunOutput {
  code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

/**
 * Dạng chỉ-đọc của subcommand mà chính sách xếp `write` — khớp `READ_FORMS` trong `src-tauri/src/policy.rs`. Chúng không cần
 * khoá độc quyền theo repo: nếu cứ xin `write` thì mỗi lần làm mới (`stash list`, `remote -v`) phải xếp hàng sau fetch/pull đang
 * chạy lâu và giao diện đứng hình.
 */
const READ_FORMS: Readonly<Record<string, readonly string[]>> = {
  stash: ['list', 'show'],
  remote: ['', '-v', '--verbose', 'get-url', 'show'],
};

/**
 * Loại thao tác của một lệnh theo `git-policy.json` (nguồn sự thật cho khoá theo repo và quyền huỷ). Truyền `args` để nhận ra
 * dạng chỉ-đọc của subcommand `write` (`stash list`, `remote -v`…); thiếu `args` thì chỉ xét subcommand.
 */
export function execKindOf(sub: string, args: readonly string[] = []): ExecKind {
  const kind = Object.hasOwn(gitPolicy.subcommands, sub) ? gitPolicy.subcommands[sub]?.kind : undefined;
  if (kind === 'write' && Object.hasOwn(READ_FORMS, sub) && READ_FORMS[sub]?.includes(args[0] ?? '')) {
    return 'read';
  }
  return kind ?? 'write';
}

export class GitRunner {
  constructor(
    readonly exec: Exec,
    readonly log?: CommandLog,
  ) {}

  /**
   * Chạy `git <sub> <args…>`. Loại khoá lấy từ chính sách theo subcommand. Huỷ → `CancelledError(mã thoát thật)`;
   * mã thoát ngoài `acceptExitCodes` → `GitError`. Lỗi của bộ chuyển (chính sách chặn, không chạy được git) được ghi nhật ký rồi ném lại.
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
    // Bị huỷ: báo huỷ thay vì lỗi git (mã thoát 143 do SIGTERM), nhưng vẫn mang mã thật.
    if (result.cancelled) throw new CancelledError(result.code);
    if (!acceptExitCodes.includes(result.code)) {
      throw new GitError(argv, result.code, decodeUtf8(result.stdout), decodeUtf8(result.stderr));
    }
    return { code: result.code, stdout: result.stdout, stderr: result.stderr };
  }

  /** Như `output` của Swift: stdout giải mã UTF-8. */
  async text(sub: string, args: readonly string[], options: RunOptions = {}): Promise<string> {
    return decodeUtf8((await this.run(sub, args, options)).stdout);
  }
}
