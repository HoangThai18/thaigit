// Temporary repository for integration tests (real git in a temp directory), isolated from the machine's git config:
// GIT_CONFIG_GLOBAL=/dev/null (NUL on Windows) + GIT_CONFIG_NOSYSTEM=1, plus user.name/email and commit.gpgsign=false at
// the repo level.

import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildGitEnv } from '@thaigit/contracts';
import type { CommandLog, GitRepository } from '../../src/git/index.ts';
import { NodeGitHost, openRepository, type NodeGitConfig } from '../../src/node/index.ts';

export const IS_WINDOWS = process.platform === 'win32';

/** Node adapter config isolated from `~/.gitconfig` and the system config. `extraEnv` adds variables to the base environment. */
export function isolatedConfig(extraEnv: Record<string, string> = {}): NodeGitConfig {
  return {
    baseEnv: {
      ...process.env,
      GIT_CONFIG_GLOBAL: IS_WINDOWS ? 'NUL' : '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      ...extraEnv,
    },
  };
}

function rawResult(cwd: string, args: readonly string[], config: NodeGitConfig, input?: Uint8Array) {
  const env = buildGitEnv(config.baseEnv ?? process.env, { profile: 'interactive' });
  return spawnSync('git', [...args], { cwd, env, input, maxBuffer: 256 * 1024 * 1024 });
}

/** Runs real git WITHOUT the policy (only for setting up / checking test data). Returns stdout; throws on a non-zero exit code. */
export function rawGit(
  cwd: string,
  args: readonly string[],
  config: NodeGitConfig = isolatedConfig(),
  input?: Uint8Array,
): string {
  const result = rawResult(cwd, args, config, input);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} thất bại (${result.status}): ${result.stderr.toString('utf8')}`);
  }
  return result.stdout.toString('utf8');
}

/** Like `rawGit` but returns bytes. */
export function rawGitBytes(
  cwd: string,
  args: readonly string[],
  config: NodeGitConfig = isolatedConfig(),
): Uint8Array {
  const result = rawResult(cwd, args, config);
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')} thất bại (${result.status}): ${result.stderr.toString('utf8')}`);
  return new Uint8Array(result.stdout);
}

export interface TestRepo {
  /** Repo root (already realpath-ed). */
  readonly root: string;
  readonly repo: GitRepository;
  readonly config: NodeGitConfig;
  write(path: string, content: string | Uint8Array): Promise<void>;
  read(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  /** Real git (bypassing the policy) in the repo root, returning stdout. */
  git(...args: string[]): string;
  /** `stageAll` then `commit`, using the repository's own API. */
  commitAll(message: string): Promise<void>;
}

/** Realpath-ed temp directory for one test; always cleaned up, even when the test fails. */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'thaigit-test-')));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

/** Build a temp repo inside `dir` (which must exist): init `main`, user.name/email, commit signing off. */
export async function createTestRepoIn(
  dir: string,
  config: NodeGitConfig = isolatedConfig(),
): Promise<TestRepo> {
  await new NodeGitHost(config).init(dir);
  rawGit(dir, ['config', 'user.name', 'Nhánh Test'], config);
  rawGit(dir, ['config', 'user.email', 'test@example.com'], config);
  rawGit(dir, ['config', 'commit.gpgsign', 'false'], config);
  return wrap(await openRepository(dir, config), config);
}

function wrap(repo: GitRepository, config: NodeGitConfig): TestRepo {
  const root = repo.root;
  return {
    root,
    repo,
    config,
    async write(path, content) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    },
    async read(path) {
      return readFile(join(root, path), 'utf8');
    },
    async readBytes(path) {
      return new Uint8Array(await readFile(join(root, path)));
    },
    async exists(path) {
      return stat(join(root, path)).then(
        () => true,
        () => false,
      );
    },
    git(...args) {
      return rawGit(root, args, config);
    },
    async commitAll(message) {
      await repo.stageAll();
      await repo.commit(message);
    },
  };
}

/** Run `fn` with a temp repo; cleaned up afterwards. */
export async function withTestRepo<T>(
  fn: (t: TestRepo) => Promise<T>,
  config: NodeGitConfig = isolatedConfig(),
): Promise<T> {
  return withTempDir(async (parent) => {
    const dir = join(parent, 'repo');
    await mkdir(dir);
    return fn(await createTestRepoIn(dir, config));
  });
}

/** Multi-line content "line 1", "line 2", … */
export function numberedLines(count: number, prefix = 'line'): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`);
}

/** Write an executable script (POSIX) and return its path. Only for tests skipped on Windows. */
export async function writeExecutableScript(path: string, body: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

/** Local bare remote pre-loaded with one "init" commit (a.txt = "1\n") on `main`. Returns the bare directory path. */
export async function createBareRemote(
  parent: string,
  config: NodeGitConfig = isolatedConfig(),
): Promise<string> {
  const bare = join(parent, 'origin.git');
  rawGit(parent, ['init', '--bare', '-b', 'main', bare], config);
  const seedDir = join(parent, 'seed');
  await mkdir(seedDir);
  const seed = await createTestRepoIn(seedDir, config);
  await seed.write('a.txt', '1\n');
  await seed.commitAll('init');
  seed.git('push', bare, 'main');
  return bare;
}

/** Clone `source` into `<parent>/<name>` with `GitHost.clone`, then open it with the Node adapters and set a commit identity for that repo. */
export async function cloneTestRepo(
  parent: string,
  source: string,
  name: string,
  config: NodeGitConfig = isolatedConfig(),
  log?: CommandLog,
): Promise<TestRepo> {
  const destination = join(parent, name);
  await new NodeGitHost(config).clone(source, destination);
  rawGit(destination, ['config', 'user.name', `Clone ${name}`], config);
  rawGit(destination, ['config', 'user.email', `${name}@example.com`], config);
  rawGit(destination, ['config', 'commit.gpgsign', 'false'], config);
  return wrap(await openRepository(destination, { ...config, log }), config);
}

/** Wait until `condition` holds (polling every 20 ms); throws on timeout. */
export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('Quá thời gian chờ điều kiện');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Whether the file exists. */
export async function fileExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** Whether process `pid` is still alive (signal 0 only checks, it sends nothing). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * A "hanging" script simulating slow ssh/network: it writes its pid to `<dir>/<name>.pid` and then sleeps for a long
 * time (`exec`, so that pid IS the sleeping process's). Returns the script path and a pid reader (waits until the script
 * has started).
 */
export async function createHangScript(
  dir: string,
  name = 'hang',
): Promise<{ script: string; pid: () => Promise<number> }> {
  const pidFile = join(dir, `${name}.pid`);
  const script = await writeExecutableScript(
    join(dir, `${name}.sh`),
    `echo $$ > "${pidFile}"\nexec sleep 30`,
  );
  return {
    script,
    async pid() {
      await waitFor(
        async () => (await fileExists(pidFile)) && (await readFile(pidFile, 'utf8')).trim() !== '',
      );
      return Number((await readFile(pidFile, 'utf8')).trim());
    },
  };
}
