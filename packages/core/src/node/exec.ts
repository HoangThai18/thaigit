// Bộ chuyển `Exec` cho Node (test, công cụ dòng lệnh): cùng chính sách với Rust — LUÔN gọi `validateGitCommand` trước,
// đối số dựng bằng `buildGitArgv` (cờ `-c` + `--no-ext-diff --no-textconv`), env bằng `buildGitEnv`.

import { realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { buildGitArgv, validateGitCommand, type PolicyViolation } from '@thaigit/contracts';
import { AdapterError } from '../git/runner.ts';
import type { Exec, ExecRequest, ExecResult } from '../ports/index.ts';
import { relativeTo } from '../support/paths.ts';
import { gitEnvFor, spawnGit, type NodeGitConfig } from './process.ts';

export interface NodeExecOptions extends NodeGitConfig {
  /** Thư mục chạy git: gốc working tree của repo. */
  cwd: string;
  /** Git dir của repo — cần để chấp nhận `GIT_INDEX_FILE` (chỉ đường dẫn nằm trong git dir). */
  gitDir?: string;
}

/** Thông báo tiếng Việt cho một vi phạm chính sách. */
export function describePolicyViolation(violation: PolicyViolation): string {
  const detail = 'detail' in violation ? `: ${violation.detail}` : '';
  return `Lệnh git ${violation.sub} bị chính sách chặn (${violation.code}${detail}).`;
}

const CASE_INSENSITIVE = process.platform === 'win32';

export class NodeExec implements Exec {
  constructor(private readonly options: NodeExecOptions) {}

  async run(request: ExecRequest): Promise<ExecResult> {
    const callerEnv = request.env ?? {};
    const violation = validateGitCommand(request.sub, request.args, callerEnv);
    if (violation) throw new AdapterError('policy', describePolicyViolation(violation), violation);
    const indexFile = callerEnv.GIT_INDEX_FILE;
    if (indexFile !== undefined) await this.assertInsideGitDir(request.sub, indexFile);

    return spawnGit({
      ...this.options,
      argv: buildGitArgv(request.sub, request.args),
      cwd: this.options.cwd,
      env: gitEnvFor(this.options, request.profile ?? 'interactive', callerEnv),
      stdin: request.stdin,
      // Chỉ lệnh mạng huỷ được (huỷ theo bậc: SIGTERM rồi SIGKILL); lệnh ghi không bao giờ bị giết giữa chừng.
      cancellable: request.kind === 'network',
      signal: request.signal,
      onStderrLine: request.onStderrLine,
    });
  }

  /** `GIT_INDEX_FILE` chỉ được trỏ vào file nằm trong git dir (kiểm sau khi giải symlink thư mục chứa nó). */
  private async assertInsideGitDir(sub: string, value: string): Promise<void> {
    const reject = (): never => {
      throw new AdapterError('policy', 'GIT_INDEX_FILE phải là đường dẫn nằm trong git dir của repo.', {
        code: 'env-rejected',
        sub,
        detail: 'GIT_INDEX_FILE',
      });
    };
    const { gitDir, cwd } = this.options;
    if (gitDir === undefined || value.includes('\0')) return reject();
    const file = resolve(cwd, value);
    let realGitDir: string;
    let realParent: string;
    try {
      [realGitDir, realParent] = await Promise.all([realpath(gitDir), realpath(dirname(file))]);
    } catch {
      return reject();
    }
    const inside = relativeTo(realGitDir, join(realParent, basename(file)), CASE_INSENSITIVE);
    if (inside === null || inside === '') reject();
  }
}
