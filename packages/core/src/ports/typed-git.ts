import type { RebaseResult, RebaseStepRequest } from '@thaigit/contracts';

/**
 * Lệnh git có kiểu — không đi qua `Exec.run` vì validator chặn (ghi cấu hình tuỳ ý, URL remote là chỗ chạy lệnh, rebase
 * tương tác cần sequence editor). Rust: `git_config_set` (key thuộc `configSetAllowlist`), `git_remote_add` /
 * `git_remote_set_url` (URL đã kiểm), `git_rebase_interactive` (kế hoạch có cấu trúc, Rust tự soạn todo).
 */
export interface TypedGit {
  configSet(key: string, value: string, scope: 'local' | 'global'): Promise<void>;
  remoteAdd(name: string, url: string): Promise<void>;
  remoteSetUrl(name: string, url: string): Promise<void>;
  /**
   * Thêm worktree trong `<destToken>/<name>` (token do hộp thoại chọn thư mục cấp). `createBranch`: tạo nhánh mới `branch` từ
   * `start` (null = HEAD); không thì checkout nhánh có sẵn. Trả đường dẫn worktree mới.
   */
  worktreeAdd(
    destToken: string,
    name: string,
    branch: string,
    createBranch: boolean,
    start: string | null,
  ): Promise<string>;
  /** `git rebase -i --autostash <onto>` theo kế hoạch; mã thoát ≠ 0 trả về (không ném) để phía gọi dựng `GitError`. */
  rebaseInteractive(onto: string, steps: readonly RebaseStepRequest[]): Promise<RebaseResult>;
}
