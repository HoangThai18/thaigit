// Typed git commands on Node (`TypedGit`): they bypass `NodeExec`/the validator because the validator blocks them
// (arbitrary config writes, remote URLs as a command-execution vector). Each command validates its own input against the
// policy: config keys must be in `configSetAllowlist`, URLs must not be `ext::`/`fd::`/start with `-`, and remote names
// must not be mistakable for options.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildGitArgv,
  gitPolicy,
  type PolicyViolation,
  type RebaseResult,
  type RebaseStepRequest,
} from '@thaigit/contracts';
import { decodeUtf8 } from '../git/bytes.ts';
import { AdapterError, GitError } from '../git/runner.ts';
import type { TypedGit } from '../ports/index.ts';
import { gitEnvFor, spawnGit, type NodeGitConfig } from './process.ts';
import { buildRebaseTodo, sequenceEditor, validateRebasePlan } from './rebase-todo.ts';

export interface NodeTypedGitOptions extends NodeGitConfig {
  /** Working-tree root of the repo (the directory git runs in). */
  cwd: string;
  /** Git dir of the repo (where the interactive-rebase todo file is written); asks `git rev-parse --absolute-git-dir` when absent. */
  gitDir?: string;
}

function policyError(message: string, violation: PolicyViolation): AdapterError {
  return new AdapterError('policy', message, violation);
}

/** Does the key match an allowlist entry (`*` = one or more characters, e.g. `branch.*.remote`; case-insensitive)? */
export function isAllowedConfigKey(key: string): boolean {
  if (/[\s\u0000-\u001f\u007f]/.test(key)) return false;
  const lower = key.toLowerCase();
  return gitPolicy.configSetAllowlist.some((pattern) => {
    const regex = new RegExp(`^${pattern.toLowerCase().split('*').map(escapeRegExp).join('.+')}$`);
    return regex.test(lower);
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Remote URL safe to store in config / hand to git: rejects `ext::`, `fd::`, a leading `-`, leading/trailing whitespace and control characters. */
export function assertSafeRemoteUrl(url: string, sub: string): void {
  const lower = url.toLowerCase();
  const reject = (detail: string): never => {
    throw policyError(`URL remote bị chính sách chặn: ${detail}`, { code: 'url-rejected', sub, detail: url });
  };
  if (url === '' || url !== url.trim() || /[\u0000-\u001f\u007f]/.test(url))
    reject('URL rỗng hoặc chứa khoảng trắng/ký tự điều khiển');
  if (gitPolicy.url.rejectPrefixes.some((prefix) => lower.startsWith(prefix)))
    reject('tiền tố không được phép');
  const scheme = /^([a-z][a-z0-9+.-]*)::/.exec(lower)?.[1];
  if (scheme !== undefined && gitPolicy.url.rejectSchemes.includes(scheme))
    reject(`transport "${scheme}" không được phép`);
}

function assertSafeRemoteName(name: string, sub: string): void {
  if (name === '' || name.startsWith('-') || /[\s\u0000-\u001f\u007f]/.test(name)) {
    throw policyError(`Tên remote không hợp lệ: ${JSON.stringify(name)}`, {
      code: 'flag-rejected',
      sub,
      detail: name,
    });
  }
}

export class NodeTypedGit implements TypedGit {
  constructor(private readonly options: NodeTypedGitOptions) {}

  async configSet(key: string, value: string, scope: 'local' | 'global'): Promise<void> {
    if (!isAllowedConfigKey(key)) {
      throw policyError(`Khoá cấu hình "${key}" không nằm trong danh sách cho phép.`, {
        code: 'config-write',
        sub: 'config',
      });
    }
    if (value.includes('\0'))
      throw policyError('Giá trị cấu hình chứa ký tự NUL.', { code: 'config-write', sub: 'config' });
    // `branch.*.remote` also takes a URL: apply the URL rules so a command-executing transport cannot be set.
    if (key.toLowerCase().endsWith('.remote')) assertSafeRemoteUrl(value, 'config');
    await this.run('config', [scope === 'global' ? '--global' : '--local', key, value]);
  }

  async remoteAdd(name: string, url: string): Promise<void> {
    assertSafeRemoteName(name, 'remote');
    assertSafeRemoteUrl(url, 'remote');
    await this.run('remote', ['add', '--', name, url]);
  }

  async remoteSetUrl(name: string, url: string): Promise<void> {
    assertSafeRemoteName(name, 'remote');
    assertSafeRemoteUrl(url, 'remote');
    await this.run('remote', ['set-url', '--', name, url]);
  }

  /** Like Rust's `git_worktree_add`; on Node the "token" is the parent directory path (as in `NodeGitHost.cloneRepo`). */
  async worktreeAdd(
    destToken: string,
    name: string,
    branch: string,
    createBranch: boolean,
    start: string | null,
  ): Promise<string> {
    for (const value of [branch, ...(start === null ? [] : [start])]) {
      if (value === '' || value.startsWith('-') || /[\s\u0000-\u001f]/.test(value))
        throw new AdapterError('policy', `Tên nhánh "${value}" không hợp lệ.`);
    }
    if (name === '' || /[/\\\0]/.test(name) || name === '.' || name === '..')
      throw new AdapterError('policy', 'Tên thư mục không hợp lệ.');
    const dest = join(destToken, name);
    const args = createBranch
      ? ['add', '-b', branch, dest, ...(start === null ? [] : [start])]
      : ['add', dest, branch];
    const result = await spawnGit({
      ...this.options,
      argv: buildGitArgv('worktree', args),
      cwd: this.options.cwd,
      env: gitEnvFor(this.options, 'background'),
      cancellable: false,
    });
    if (result.code !== 0)
      throw new GitError(
        ['worktree', ...args],
        result.code,
        decodeUtf8(result.stdout),
        decodeUtf8(result.stderr),
      );
    return dest;
  }

  /** Like Rust's `git_rebase_interactive`: todo plus message file under `<gitDir>/thaigit-rebase/`, sequence editor only copies the file. */
  async rebaseInteractive(onto: string, steps: readonly RebaseStepRequest[]): Promise<RebaseResult> {
    validateRebasePlan(onto, steps);
    const directory = join(await this.gitDir(), 'thaigit-rebase');
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    const messageFile = (index: number): string => join(directory, `message-${index}`);
    for (const [index, step] of steps.entries()) {
      if (step.action === 'reword') await writeFile(messageFile(index), step.message ?? '', 'utf8');
    }
    const todoPath = join(directory, 'todo');
    await writeFile(todoPath, buildRebaseTodo(steps, messageFile), 'utf8');
    const result = await spawnGit({
      ...this.options,
      argv: buildGitArgv('rebase', ['-i', '--autostash', '--no-autosquash', onto]),
      cwd: this.options.cwd,
      env: { ...gitEnvFor(this.options, 'background'), GIT_SEQUENCE_EDITOR: sequenceEditor(todoPath) },
      cancellable: false,
    });
    return { exitCode: result.code, stdout: decodeUtf8(result.stdout), stderr: decodeUtf8(result.stderr) };
  }

  private async gitDir(): Promise<string> {
    if (this.options.gitDir !== undefined) return this.options.gitDir;
    const result = await spawnGit({
      ...this.options,
      argv: buildGitArgv('rev-parse', ['--absolute-git-dir']),
      cwd: this.options.cwd,
      env: gitEnvFor(this.options, 'background'),
      cancellable: false,
    });
    if (result.code !== 0) throw new AdapterError('io', 'Không tìm được git dir của repo.');
    return decodeUtf8(result.stdout).trim();
  }

  private async run(sub: string, args: readonly string[]): Promise<void> {
    const result = await spawnGit({
      ...this.options,
      argv: buildGitArgv(sub, args),
      cwd: this.options.cwd,
      env: gitEnvFor(this.options, 'interactive'),
      cancellable: false,
    });
    if (result.code !== 0)
      throw new GitError([sub, ...args], result.code, decodeUtf8(result.stdout), decodeUtf8(result.stderr));
  }
}
