// Mở repository trên Node: `git rev-parse` tính gốc/git dir/common dir rồi chuẩn hoá bằng realpath (git trả `C:/…` trên
// Windows, `/private/tmp` thay vì `/tmp` trên macOS), dựng `GitRepository` với bộ chuyển Node.

import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { GitError, GitRunner } from '../git/runner.ts';
import { GitRepository, RepositoryError } from '../git/repository.ts';
import type { CommandLog } from '../support/command-log.ts';
import { NodeExec } from './exec.ts';
import { NodeGitHost } from './git-host.ts';
import type { NodeGitConfig } from './process.ts';
import { NodeRepoFs } from './repo-fs.ts';
import { NodeTypedGit } from './typed-git.ts';

export interface OpenRepositoryOptions extends NodeGitConfig {
  log?: CommandLog;
}

/** Ba đường dẫn của một repo, đã realpath. */
export interface RepositoryLocation {
  root: string;
  gitDir: string;
  commonDir: string;
}

/** Tìm repo chứa thư mục `path`. Ném `RepositoryError` nếu không phải repo hoặc là bare repo. */
export async function locateRepository(
  path: string,
  options: OpenRepositoryOptions = {},
): Promise<RepositoryLocation> {
  const directory = resolve(path);
  const isDirectory = await stat(directory).then(
    (info) => info.isDirectory(),
    () => false,
  );
  if (!isDirectory) throw new RepositoryError('notARepository', path);

  const probe = new GitRunner(new NodeExec({ ...options, cwd: directory }), options.log);
  let output: string;
  try {
    output = await probe.text('rev-parse', ['--show-toplevel', '--absolute-git-dir', '--git-common-dir']);
  } catch (error) {
    if (error instanceof GitError) {
      if (error.contains('must be run in a work tree') || error.contains('bare repository'))
        throw new RepositoryError('bareRepository', path);
      if (error.contains('not a git repository')) throw new RepositoryError('notARepository', path);
    }
    throw error;
  }
  const lines = output
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line !== '');
  const [toplevel, absoluteGitDir, commonLine] = lines;
  if (
    lines.length < 3 ||
    toplevel === undefined ||
    absoluteGitDir === undefined ||
    commonLine === undefined
  ) {
    throw new RepositoryError('notARepository', path);
  }
  // `--git-common-dir` có thể là đường dẫn tương đối so với thư mục đang chạy.
  const [root, gitDir, commonDir] = await Promise.all([
    realpath(toplevel),
    realpath(absoluteGitDir),
    realpath(resolve(directory, commonLine)),
  ]);
  return { root, gitDir, commonDir };
}

/** Mở repository tại `path` với đầy đủ bộ chuyển Node (`Exec`, `RepoFs`, lệnh có kiểu). */
export async function openRepository(
  path: string,
  options: OpenRepositoryOptions = {},
): Promise<GitRepository> {
  const { root, gitDir, commonDir } = await locateRepository(path, options);
  return new GitRepository({
    exec: new NodeExec({ ...options, cwd: root, gitDir }),
    fs: new NodeRepoFs({ root, gitDir, commonDir }),
    typed: new NodeTypedGit({ ...options, cwd: root, gitDir }),
    root,
    gitDir,
    commonDir,
    log: options.log,
  });
}

/** Bộ chuyển `GitHost` (version/init/clone) cùng cấu hình git với `openRepository`. */
export function createGitHost(options: NodeGitConfig = {}): NodeGitHost {
  return new NodeGitHost(options);
}
