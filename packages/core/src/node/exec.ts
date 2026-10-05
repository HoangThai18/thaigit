// Node adapter for `Exec` (tests, CLI tools): same policy as Rust — ALWAYS validates with `validateGitCommand` first,
// builds args with `buildGitArgv` (`-c` flags plus `--no-ext-diff --no-textconv`) and env with `buildGitEnv`.

import { realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { buildGitArgv, validateGitCommand, type PolicyViolation } from '@thaigit/contracts';
import { AdapterError } from '../git/runner.ts';
import type { Exec, ExecRequest, ExecResult } from '../ports/index.ts';
import { relativeTo } from '../support/paths.ts';
import { gitEnvFor, spawnGit, type NodeGitConfig } from './process.ts';

export interface NodeExecOptions extends NodeGitConfig {
  /** Directory git runs in: the repo's working-tree root. */
  cwd: string;
  /** The repo's git dir — needed to accept `GIT_INDEX_FILE` (only paths inside the git dir are allowed). */
  gitDir?: string;
}

/** Human-readable message for a policy violation. */
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
      // Only network commands are cancellable (cancelled in stages: SIGTERM then SIGKILL); a write command must never be killed mid-way.
      cancellable: request.kind === 'network',
      signal: request.signal,
      onStderrLine: request.onStderrLine,
    });
  }

  /** `GIT_INDEX_FILE` may only point at a file inside the git dir (checked after resolving symlinks in its directory). */
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
