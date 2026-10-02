/**
 * Lệnh git có kiểu — không đi qua `Exec.run` vì validator chặn (ghi cấu hình tuỳ ý, URL remote là chỗ chạy lệnh).
 * Rust: `git_config_set` (key thuộc `configSetAllowlist`), `git_remote_add` / `git_remote_set_url` (URL đã kiểm).
 */
export interface TypedGit {
  configSet(key: string, value: string, scope: 'local' | 'global'): Promise<void>;
  remoteAdd(name: string, url: string): Promise<void>;
  remoteSetUrl(name: string, url: string): Promise<void>;
}
