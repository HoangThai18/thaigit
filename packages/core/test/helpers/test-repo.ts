// Repository tạm cho integration test (git thật trong thư mục tạm), cô lập khỏi cấu hình git của máy:
// GIT_CONFIG_GLOBAL=/dev/null (NUL trên Windows) + GIT_CONFIG_NOSYSTEM=1, user.name/email và commit.gpgsign=false ở cấp repo.

import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildGitEnv } from '@thaigit/contracts';
import type { CommandLog, GitRepository } from '../../src/git/index.ts';
import { NodeGitHost, openRepository, type NodeGitConfig } from '../../src/node/index.ts';

export const IS_WINDOWS = process.platform === 'win32';

/** Cấu hình adapter Node cô lập khỏi `~/.gitconfig` và cấu hình hệ thống. `extraEnv` thêm biến vào môi trường gốc. */
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

/** Chạy git thật KHÔNG qua chính sách (chỉ để dựng/kiểm dữ liệu trong test). Trả stdout; mã thoát ≠ 0 thì ném lỗi. */
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

/** Như `rawGit` nhưng trả byte. */
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
  /** Gốc repo (đã realpath). */
  readonly root: string;
  readonly repo: GitRepository;
  readonly config: NodeGitConfig;
  write(path: string, content: string | Uint8Array): Promise<void>;
  read(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  /** Git thật (không qua chính sách) trong gốc repo, trả stdout. */
  git(...args: string[]): string;
  /** `stageAll` rồi `commit` bằng chính API của repository. */
  commitAll(message: string): Promise<void>;
}

/** Thư mục tạm (realpath) cho một bài test; luôn dọn dù test lỗi. */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'thaigit-test-')));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

/** Dựng repo tạm trong `dir` (đã tồn tại): init `main`, user.name/email, tắt ký commit. */
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

/** Chạy `fn` với một repo tạm; dọn sau khi xong. */
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

/** Nội dung nhiều dòng "line 1", "line 2", … */
export function numberedLines(count: number, prefix = 'line'): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`);
}

/** Ghi script thực thi (POSIX) và trả đường dẫn. Chỉ dùng ở test bỏ qua trên Windows. */
export async function writeExecutableScript(path: string, body: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

/** Remote bare cục bộ có sẵn một commit "init" (a.txt = "1\n") trên `main`. Trả đường dẫn thư mục bare. */
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

/** Clone `source` vào `<parent>/<name>` bằng `GitHost.clone` rồi mở bằng bộ chuyển Node, đặt danh tính commit cho repo đó. */
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

/** Chờ tới khi `condition` đúng (thăm dò 20 ms một lần); quá hạn thì ném lỗi. */
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

/** File tồn tại chưa. */
export async function fileExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** Tiến trình `pid` còn sống không (tín hiệu 0 chỉ kiểm tra, không gửi gì). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Script "treo" giả lập ssh/mạng chậm: ghi pid vào `<dir>/<name>.pid` rồi ngủ lâu (`exec` nên pid chính là của tiến
 * trình ngủ). Trả đường dẫn script và hàm đọc pid (chờ tới khi script đã chạy).
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
