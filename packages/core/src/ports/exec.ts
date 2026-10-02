import type { EnvProfile, ExecKind } from '@thaigit/contracts';

/** Một lệnh git trong repo đã mở. Cờ `-c`, env chuẩn và kiểm tra chính sách do adapter lo (Rust trong app). */
export interface ExecRequest {
  /** `read` không khoá repo (status chạy với GIT_OPTIONAL_LOCKS=0); `write`/`network` độc quyền theo repo. */
  kind: ExecKind;
  /** Subcommand trong allowlist của git-policy.json. */
  sub: string;
  /** Giá trị tự do (message, tên file…) dùng dạng `--opt=value`, stdin, hoặc sau `--` — không tách rời sau cờ ngắn. */
  args: readonly string[];
  stdin?: Uint8Array;
  /** Chỉ khoá trong `env.fromCaller` của chính sách (GIT_OPTIONAL_LOCKS, GIT_LITERAL_PATHSPECS, GIT_INDEX_FILE). */
  env?: Readonly<Record<string, string>>;
  /** Mặc định `interactive`; tự fetch dùng `background` (không bao giờ bật hộp thoại đăng nhập). */
  profile?: EnvProfile;
  /** Mỗi dòng stderr (tiến trình clone/fetch/push), giữ nguyên byte. */
  onStderrLine?: (line: Uint8Array) => void;
  /** Chỉ lệnh `network` huỷ được (huỷ theo bậc). */
  signal?: AbortSignal;
}

export interface ExecResult {
  code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
  /** Bị huỷ: mã thoát vẫn giữ để biết git đã làm tới đâu. */
  cancelled: boolean;
}

/** Chạy git trong một repo đã mở: adapter Node (test) và adapter Tauri (app). */
export interface Exec {
  run(request: ExecRequest): Promise<ExecResult>;
}
