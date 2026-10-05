import { Commands, type OpenedRepo } from '@thaigit/contracts';
import { call } from './invoke.ts';
import type { GitInfo, OpenSource, PickedFolder, RecentRepo, RepoHealth } from './types.ts';

/** Repo on github.com: `owner` + `name` (Rust builds the URL; raw URLs are never accepted from the webview). */
export interface GithubRepoRef {
  readonly owner: string;
  readonly name: string;
}

// --- folder picking / opening a repo (paths only ever come from Rust: native dialog, "Open With", recent list) -

/** Native folder picker. `null` = the user hit Cancel. Feed the returned token to `openRepo` / `cloneRepo` / `initRepo`. */
export function pickRepoFolder(): Promise<PickedFolder | null> {
  return call<PickedFolder | null>(Commands.pickRepoFolder);
}

export function openRepoInfo(source: OpenSource): Promise<OpenedRepo> {
  return call<OpenedRepo>(Commands.openRepo, { source });
}

export function trustRepoInfo(repoId: string): Promise<OpenedRepo> {
  return call<OpenedRepo>(Commands.trustRepo, { repoId });
}

export function listRecentRepos(): Promise<RecentRepo[]> {
  return call<RecentRepo[]>(Commands.listRecentRepos);
}

export function forgetRecentRepo(id: string): Promise<void> {
  return call<void>(Commands.forgetRecentRepo, { id });
}

/** Folder the OS handed us at startup (argv / "Open With"): read once, as a token. */
export function takeLaunchFolders(): Promise<PickedFolder[]> {
  return call<PickedFolder[]>(Commands.takeLaunchPaths);
}

// --- repo health ----------------------------------------------------------------------------------------------

export function repoHealth(repoId: string): Promise<RepoHealth> {
  return call<RepoHealth>(Commands.repoHealth, { repoId });
}

/** Remove an orphaned lock reported by `repoHealth` — only call after the user confirms. */
export function removeStaleLock(repoId: string, path: string): Promise<void> {
  return call<void>(Commands.removeStaleLock, { repoId, path });
}

/**
 * Commit-author avatar as a data URL (`null` = none / download failed). Rust downloads and caches it;
 * the webview has no network access of its own so it must go through IPC. `github` is the open repo's
 * github.com repo (omit it to skip the GitHub API source) — Rust builds the URL and picks the token.
 */
export function avatarLookup(email: string, github: GithubRepoRef | null): Promise<string | null> {
  return call<string | null>(Commands.avatarLookup, {
    email,
    owner: github?.owner ?? null,
    repo: github?.name ?? null,
  });
}

// --- git (discovery) ------------------------------------------------------------------------------------------

export function locateGit(): Promise<GitInfo> {
  return call<GitInfo>(Commands.gitLocate);
}

/** `null` = auto-detect. Only one of `GitInfo.candidates` is accepted (Rust won't let the webview point git at an arbitrary file). */
export function setGitPath(path: string | null): Promise<GitInfo> {
  return call<GitInfo>(Commands.setGitPath, { path });
}

/** Pick the git binary with the native dialog. `null` = Cancel. */
export function pickGitPath(): Promise<GitInfo | null> {
  return call<GitInfo | null>(Commands.pickGitPath);
}

/** A new webview has finished loading: cancel the child ops and drop the previous session's watchers (Rust also does this itself on a page reload). */
export function sessionReset(): Promise<void> {
  return call<void>(Commands.sessionReset);
}
