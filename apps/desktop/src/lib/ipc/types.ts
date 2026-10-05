// Rust return shapes that `@thaigit/contracts` doesn't describe yet (serde camelCase). Keep in sync with `src-tauri/src`.

/** Folder picked by the native dialog: only `token` is something Rust accepts back; `path` is display-only. */
export interface PickedFolder {
  token: string;
  name: string;
  path: string;
}

/** Where a repo was opened from: a token from the dialog / "Open With" / native file drop, or an id in the recent list Rust stores. */
export type OpenSource = { kind: 'picked'; token: string } | { kind: 'recent'; id: string };

export interface RecentRepo {
  id: string;
  name: string;
  /** Display only. */
  path: string;
  /** Milliseconds since the epoch. */
  lastOpened: number;
}

export interface LockFile {
  /** Absolute path in the OS's own form — also the identity used to remove it (`removeStaleLock`). */
  path: string;
  /** Relative to the git directory holding the lock (`index.lock`, `refs/heads/main.lock`), always using `/` (even on Windows). */
  relativePath: string;
  ageSecs: number;
}

export type RepoOperationKind = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'am' | 'bisect';

export interface RepoHealth {
  /** Orphaned lock; empty while the app still has a git command running on the repo (`busy`). */
  staleLocks: LockFile[];
  operation: RepoOperationKind | null;
  busy: boolean;
}

export interface GitInfo {
  path: string;
  /** `git --version` verbatim. */
  version: string;
  versionTuple: [number, number, number];
  source: 'setting' | 'path' | 'fallback' | 'where';
  /** Below 2.35: a needed feature is missing, every command is refused. */
  tooOld: boolean;
  /** Below the security floor: clone/fetch/pull are blocked. */
  belowSecurityFloor: boolean;
  minimumVersion: string | null;
  warning: string | null;
  loginShellPathLoaded: boolean;
  /** The git binaries Rust found — `setGitPath` only accepts one of these. */
  candidates: string[];
}

export type ConfigScope = 'local' | 'global';
