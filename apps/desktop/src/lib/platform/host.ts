/**
 * A "Host" is everything the UI needs from outside the webview: opening a repo (native dialog / recent
 * list / "Open With…") and an already-open repo (`exec`, `fs`, change watching, trust). The real app uses
 * Tauri (`core-tauri.ts`, through the Rust core); when running dev in a plain browser it uses the
 * read-only DEV bridge (`dev-bridge-client.ts`, loaded via a conditional `import()` guarded by
 * `import.meta.env.DEV` so builds never contain it). The rest of the UI only knows the types here.
 */
import type { OpenedRepo, RepoChangedEvent } from '@thaigit/contracts';
import type { Exec, RepoFs, TypedGit } from '@thaigit/core';
import {
  createGitHost,
  listRecentRepos,
  forgetRecentRepo,
  openRepo,
  pickAndOpenRepo,
  takeLaunchFolders,
} from '../core-tauri.ts';
import { pickRepoFolder } from '../ipc/host.ts';
import type { PickedFolder, RecentRepo } from '../ipc/types.ts';

/** The part of an opened repo the UI uses. `TauriRepo` structurally satisfies this. */
export interface RepoPort {
  readonly info: OpenedRepo;
  readonly exec: Exec;
  readonly fs: RepoFs;
  readonly typedGit?: TypedGit;
  /** Changes, already debounced and gitignore-filtered at the source (Rust) — receivers must NOT debounce again. Returns a stop function. */
  watch(onChange: (event: RepoChangedEvent) => void): Promise<() => Promise<void>>;
  /** Record trust; returns a new repo in the `trusted` state. */
  trust(): Promise<RepoPort>;
  /** OS integration (Tauri app only): open a terminal / editor / file manager at the repo. */
  openInTerminal?(): Promise<void>;
  openInEditor?(relativePath?: string): Promise<void>;
  reveal?(relativePath?: string): Promise<void>;
  /** Open one of this repo's worktrees (path reported by git) / submodules (path inside the repo) in a new window (Tauri app only). */
  openRelated?(kind: 'worktree' | 'submodule', path: string): Promise<void>;
}

export interface Host {
  readonly kind: 'tauri' | 'dev-bridge';
  /** Pick a folder then open it right away; `null` = the user hit Cancel. */
  pickAndOpenRepo(): Promise<RepoPort | null>;
  openRecent(id: string): Promise<RepoPort>;
  listRecentRepos(): Promise<RecentRepo[]>;
  forgetRecentRepo(id: string): Promise<void>;
  /** Folder the OS handed us at startup (argv, "Open With…"): open the first one, `null` when there is none. */
  openLaunchRepo(): Promise<RepoPort | null>;
  /** Folder picker (where a cloned / new repo goes); `null` = Cancel. */
  pickFolder(): Promise<PickedFolder | null>;
  /** Clone `url` into the `name` subfolder of `folder`, then open it (trusted). Cancel with `signal`. */
  cloneRepo(
    url: string,
    folder: PickedFolder,
    name: string,
    options: { onProgress?: (line: string) => void; signal?: AbortSignal },
  ): Promise<RepoPort>;
  /** Create a new repo in the `name` subfolder of `folder`, then open it. */
  initRepo(folder: PickedFolder, name: string): Promise<RepoPort>;
}

export function hasTauriInternals(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export type OsFamily = 'mac' | 'windows' | 'other';

export function detectOs(): OsFamily {
  const platform = typeof navigator === 'undefined' ? '' : `${navigator.userAgent} ${navigator.platform}`;
  if (/Mac|iPhone|iPad/i.test(platform)) return 'mac';
  if (/Win/i.test(platform)) return 'windows';
  return 'other';
}

export function createTauriHost(): Host {
  return {
    kind: 'tauri',
    pickAndOpenRepo: () => pickAndOpenRepo(),
    openRecent: (id) => openRepo({ kind: 'recent', id }),
    listRecentRepos: () => listRecentRepos(),
    forgetRecentRepo: (id) => forgetRecentRepo(id),
    async openLaunchRepo() {
      const [first] = await takeLaunchFolders();
      return first ? openRepo({ kind: 'picked', token: first.token }) : null;
    },
    pickFolder: () => pickRepoFolder(),
    cloneRepo: (url, folder, name, options) =>
      createGitHost().cloneRepo(url, `${folder.token}/${name}`, options),
    initRepo: (folder, name) => createGitHost().initRepo(`${folder.token}/${name}`),
  };
}

/**
 * Pick the host: inside Tauri it is always Tauri. The DEV bridge is used only when running dev (`vite`)
 * outside Tauri and the bridge plugin injected a token. `import.meta.env.DEV` is a constant `false` in a
 * build, so this branch (and the `import()` inside it) is eliminated from releases.
 */
export async function resolveHost(): Promise<Host> {
  if (import.meta.env.DEV && !hasTauriInternals()) {
    const { createDevBridgeHost } = await import('./dev-bridge-client.ts');
    const bridge = createDevBridgeHost();
    if (bridge) return bridge;
  }
  return createTauriHost();
}
