// A real git repo in a temp directory plus a `RepoPort` running through @thaigit/core's Node adapter — used
// by the RepoStore tests (same git code path as the dev bridge). `emit()` fakes the watcher's
// `repo-changed` event.
import { spawnSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpenedRepo, RepoChangedEvent } from '@thaigit/contracts';
import { NodeExec, NodeRepoFs, NodeTypedGit, locateRepository } from '@thaigit/core/node';
import type { RepoPort } from '../../src/lib/platform/host.ts';

const IS_WINDOWS = process.platform === 'win32';

export const ISOLATED_ENV: Record<string, string | undefined> = {
  ...process.env,
  GIT_CONFIG_GLOBAL: IS_WINDOWS ? 'NUL' : '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Phan Thái',
  GIT_AUTHOR_EMAIL: 'thai@example.com',
  GIT_COMMITTER_NAME: 'Phan Thái',
  GIT_COMMITTER_EMAIL: 'thai@example.com',
};

export function rawGit(
  cwd: string,
  args: readonly string[],
  input?: string | Uint8Array,
  extraEnv: Record<string, string> = {},
): string {
  const env = { ...ISOLATED_ENV, ...extraEnv };
  const result = spawnSync('git', [...args], { cwd, env, input, maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')} thất bại: ${result.stderr.toString('utf8')}`);
  return result.stdout.toString('utf8');
}

export interface TestPort {
  readonly root: string;
  readonly port: RepoPort;
  readonly git: (...args: string[]) => string;
  write(path: string, content: string): Promise<void>;
  /** Fake a watcher reporting a change. */
  emit(event: Omit<RepoChangedEvent, 'repoId'>): void;
  readonly watchers: { count: number; stopped: number };
  cleanup(): Promise<void>;
}

/** Create a new repo (branch `main`), run `setup`, then open it through the Node adapter. */
export async function openTestPort(
  setup: (git: (...args: string[]) => string, root: string) => void,
): Promise<TestPort> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'thaigit-desktop-test-')));
  // The fake clock advances with each command, so commits always get distinct timestamps and `--date-order` gives a stable order.
  let clock = 1_700_000_000;
  const git = (...args: string[]): string => {
    clock += 60;
    const date = `${clock} +0000`;
    return rawGit(root, args, undefined, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  };
  git('init', '-q', '-b', 'main', '.');
  setup(git, root);

  const location = await locateRepository(root, { baseEnv: ISOLATED_ENV });
  const exec = new NodeExec({ cwd: location.root, gitDir: location.gitDir, baseEnv: ISOLATED_ENV });
  const fs = new NodeRepoFs({ ...location });
  const typedGit = new NodeTypedGit({ cwd: location.root, gitDir: location.gitDir, baseEnv: ISOLATED_ENV });
  const listeners = new Set<(event: RepoChangedEvent) => void>();
  const watchers = { count: 0, stopped: 0 };
  const info: OpenedRepo = { repoId: 'test', ...location, trust: 'trusted', findings: [] };
  const port: RepoPort = {
    info,
    exec,
    fs,
    typedGit,
    async watch(onChange) {
      listeners.add(onChange);
      watchers.count++;
      return async () => {
        listeners.delete(onChange);
        watchers.stopped++;
      };
    },
    async trust() {
      return port;
    },
  };
  return {
    root: location.root,
    port,
    git,
    watchers,
    write: (path, content) => writeFile(join(root, path), content, 'utf8'),
    emit: (event) => {
      for (const listener of [...listeners]) listener({ repoId: 'test', ...event });
    },
    // On Windows a just-finished (or stopping) git process can hold the directory for a moment → EBUSY; retry with a longer wait.
    cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
  };
}

/** `count` linear commits (old → new) on `main` via `git fast-import` (hundreds of times faster than `git commit`). */
export function fastImportLinear(git: (...args: string[]) => string, root: string, count: number): void {
  const lines: string[] = [];
  for (let index = 1; index <= count; index++) {
    const message = `Sửa lỗi số ${index}`;
    lines.push(
      'commit refs/heads/main',
      `committer Phan Thái <thai@example.com> ${1_600_000_000 + index * 60} +0000`,
      `data ${Buffer.byteLength(message)}`,
      message,
    );
    lines.push('');
  }
  rawGit(root, ['fast-import', '--quiet'], lines.join('\n'));
  git('reset', '-q', '--hard', 'main');
}
