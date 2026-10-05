// Node adapter for `GitHost`: git operations not tied to a repository (version, init, clone with progress).
// `init`/`clone` are typed commands: they skip the `Exec` validator and check their own input.

import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { buildGitArgv } from '@thaigit/contracts';
import { decodeUtf8 } from '../git/bytes.ts';
import { CancelledError, GitError } from '../git/runner.ts';
import type { GitHost } from '../ports/index.ts';
import { gitEnvFor, spawnGit, type NodeGitConfig, type SpawnGitResult } from './process.ts';
import { assertSafeRemoteUrl } from './typed-git.ts';

export class NodeGitHost implements GitHost {
  constructor(private readonly config: NodeGitConfig = {}) {}

  /** e.g. "git version 2.54.0". */
  async version(): Promise<string> {
    const result = await this.run('version', [], tmpdir());
    return decodeUtf8(result.stdout).trim();
  }

  /** `git init` (default branch `main` unless the user set `init.defaultBranch`); creates the directory when missing. */
  async init(destination: string): Promise<void> {
    // Absolute path: can never be mistaken for an option.
    const directory = resolve(destination);
    await mkdir(directory, { recursive: true });
    const configured = await this.run(
      'config',
      ['--global', '--get', 'init.defaultBranch'],
      directory,
      [0, 1],
    );
    const hasDefault = configured.code === 0 && decodeUtf8(configured.stdout).trim() !== '';
    await this.run('init', [...(hasDefault ? [] : ['--initial-branch=main']), directory], directory);
  }

  async clone(
    url: string,
    destination: string,
    options: { onProgress?: (line: string) => void; signal?: AbortSignal } = {},
  ): Promise<void> {
    assertSafeRemoteUrl(url, 'clone');
    const directory = resolve(destination);
    const parent = dirname(directory);
    await mkdir(parent, { recursive: true });
    const args = ['--progress', '--', url, directory];
    const { onProgress } = options;
    const result = await spawnGit({
      ...this.config,
      argv: buildGitArgv('clone', args),
      cwd: parent,
      env: gitEnvFor(this.config, 'interactive'),
      cancellable: true,
      signal: options.signal,
      onStderrLine: onProgress
        ? (line) => {
            const text = decodeUtf8(line).trim();
            if (text !== '') onProgress(text);
          }
        : undefined,
    });
    if (result.cancelled) throw new CancelledError(result.code);
    if (result.code !== 0)
      throw new GitError(
        ['clone', ...args],
        result.code,
        decodeUtf8(result.stdout),
        decodeUtf8(result.stderr),
      );
  }

  private async run(
    sub: string,
    args: readonly string[],
    cwd: string,
    acceptExitCodes: readonly number[] = [0],
  ): Promise<SpawnGitResult> {
    const result = await spawnGit({
      ...this.config,
      argv: buildGitArgv(sub, args),
      cwd,
      env: gitEnvFor(this.config, 'interactive'),
      cancellable: false,
    });
    if (!acceptExitCodes.includes(result.code)) {
      throw new GitError([sub, ...args], result.code, decodeUtf8(result.stdout), decodeUtf8(result.stderr));
    }
    return result;
  }
}
