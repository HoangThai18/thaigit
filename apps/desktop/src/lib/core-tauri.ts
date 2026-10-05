/**
 * Tauri adapters for the `@thaigit/core` ports: `Exec`, `RepoFs`, `GitHost`, `TypedGit` — all of them go
 * through the Rust core, which is where the policy is enforced (`-c` flags, env, allowlist, path scope).
 * The webview never sets arbitrary paths, flags or env vars.
 *
 * Usage:
 * ```ts
 * const folder = await pickRepoFolder();                       // native dialog → token
 * const repo = await openRepo({ kind: 'picked', token: folder.token });
 * while (repo.info.trust === 'unknown') { … show repo.info.findings, ask the user … repo = await repo.trust(); }
 * const result = await repo.exec.run({ kind: 'read', sub: 'status', args: ['--porcelain=v2', '-z'] });
 * const bytes = await repo.fs.readWorktreeFile('src/a.ts');
 * ```
 */
import type { OpenedRepo, RepoChangedEvent } from '@thaigit/contracts';
import type { Exec, GitHost, RepoFs, TypedGit } from '@thaigit/core';
import {
  type CloneOptions,
  type OpenSource,
  type RepoHealth,
  cloneRepoInfo,
  configSet,
  createRepoFs,
  initRepoInfo,
  locateGit,
  openInEditor,
  openInTerminal,
  openRelatedRepo,
  openRepoInfo,
  pickRepoFolder,
  rebaseInteractive,
  remoteAdd,
  remoteSetUrl,
  removeStaleLock,
  repoHealth,
  reveal,
  runGit,
  trustRepoInfo,
  watchRepo,
  worktreeAdd,
} from './ipc/index.ts';

export type {
  CloneOptions,
  GitInfo,
  LockFile,
  OpenSource,
  PickedFolder,
  RecentRepo,
  RepoHealth,
  RepoOperationKind,
} from './ipc/index.ts';
export {
  CommandFailure,
  forgetRecentRepo,
  isCommandFailure,
  listRecentRepos,
  locateGit,
  onGitEnvChanged,
  openUrl,
  pickGitPath,
  pickRepoFolder,
  sessionReset,
  setGitPath,
  takeLaunchFolders,
} from './ipc/index.ts';

/** A repo opened in the Rust core, with its ports already wired up. */
export interface TauriRepo {
  readonly info: OpenedRepo;
  /** The repo's `Exec`: `kind` read/write/network, serialised per repo, soft → hard cancellation for `network`. */
  readonly exec: Exec;
  readonly fs: RepoFs;
  /**
   * Typed git commands: `configSet` (key must be in the allowlist), `remoteAdd`/`remoteSetUrl` (validated
   * URL), `rebaseInteractive` (a structured plan).
   */
  readonly typedGit: TypedGit;
  /** Watch for changes (debounced and gitignore-filtered in Rust). Returns a stop function. */
  watch(onChange: (event: RepoChangedEvent) => void): Promise<() => Promise<void>>;
  health(): Promise<RepoHealth>;
  /** Only call after the user confirms removing a lock reported by `health()`. */
  removeStaleLock(path: string): Promise<void>;
  /**
   * Record trust (the repo has config/hook locks that can run commands) — ONLY for the `info.findings` list
   * the user has already seen. If the effective config changed since (e.g. a branch switch in a terminal
   * pulled in a different `include` file) the returned repo is STILL `unknown` and `info.findings` is a NEW
   * list: show it again and call `trust()` once more. While untrusted, commands the config would run are
   *   refused with code `untrusted` (UI → "Trust repo to continue").
   */
  trust(): Promise<TauriRepo>;
  openInTerminal(): Promise<void>;
  openInEditor(relativePath?: string): Promise<void>;
  reveal(relativePath?: string): Promise<void>;
  openRelated(kind: 'worktree' | 'submodule', path: string): Promise<void>;
}

/** A repo's `TypedGit`. */
export function createTypedGit(repoId: string): TypedGit {
  return {
    configSet: (key, value, scope) => configSet(repoId, key, value, scope),
    remoteAdd: (name, url) => remoteAdd(repoId, name, url),
    remoteSetUrl: (name, url) => remoteSetUrl(repoId, name, url),
    worktreeAdd: (destToken, name, branch, createBranch, start) =>
      worktreeAdd(repoId, destToken, name, branch, createBranch, start),
    rebaseInteractive: (onto, steps) => rebaseInteractive(repoId, onto, steps),
  };
}

/** Attach the ports to an `open_repo` result. */
export function bindRepo(info: OpenedRepo): TauriRepo {
  const { repoId } = info;
  return {
    info,
    exec: { run: (request) => runGit(repoId, request) },
    fs: createRepoFs(repoId),
    typedGit: createTypedGit(repoId),
    watch: (onChange) => watchRepo(repoId, onChange),
    health: () => repoHealth(repoId),
    removeStaleLock: (path) => removeStaleLock(repoId, path),
    trust: async () => bindRepo(await trustRepoInfo(repoId)),
    openInTerminal: () => openInTerminal(repoId),
    openInEditor: (relativePath) => openInEditor(repoId, relativePath),
    reveal: (relativePath) => reveal(repoId, relativePath),
    openRelated: (kind, path) => openRelatedRepo(repoId, kind, path),
  };
}

/** Open a repo from a token (dialog / "Open With" / native file drop) or from the recent list Rust stores. */
export async function openRepo(source: OpenSource): Promise<TauriRepo> {
  return bindRepo(await openRepoInfo(source));
}

/** Pick a folder then open it right away. `null` = the user hit Cancel. */
export async function pickAndOpenRepo(): Promise<TauriRepo | null> {
  const folder = await pickRepoFolder();
  return folder ? openRepo({ kind: 'picked', token: folder.token }) : null;
}

/** `GitHost` on Tauri; `destination` is the native folder token (`token`) or `token/subfolder-name`. */
export interface TauriGitHost extends GitHost {
  /** Like `clone` but returns the opened repo (trusted) instead of `void`. */
  cloneRepo(url: string, destination: string, options?: CloneOptions): Promise<TauriRepo>;
  /** Like `init` but returns the opened repo (trusted). */
  initRepo(destination: string): Promise<TauriRepo>;
}

export function createGitHost(): TauriGitHost {
  return {
    version: async () => (await locateGit()).version,
    async init(destination) {
      await initRepoInfo(destination);
    },
    async clone(url, destination, options) {
      await cloneRepoInfo(url, destination, options);
    },
    async cloneRepo(url, destination, options) {
      return bindRepo(await cloneRepoInfo(url, destination, options));
    },
    async initRepo(destination) {
      return bindRepo(await initRepoInfo(destination));
    },
  };
}
