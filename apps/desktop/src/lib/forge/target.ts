// Which host this repo talks to: read `owner` + `repo` from the remote URL (Rust re-validates when calling
// the API). Used by the Pull Request / Merge Request area and the "Account for this repo" menu.

import { KNOWN_FORGE_HOSTS, type ForgeProvider } from '@thaigit/contracts';

export interface ForgeTarget {
  host: string;
  provider: ForgeProvider | null;
  /** First path segment (user / organisation / root group). */
  owner: string;
  /** What follows the owner, `.git` stripped (`app`, or `sub/app` for a GitLab subgroup). */
  repo: string;
  /** Full remote URL (display only). */
  url: string;
}

/** Provider guessed from the host: the three official hosts, then names containing gitlab / bitbucket / github (self-hosted); otherwise `null`. */
export function providerOfHost(host: string): ForgeProvider | null {
  const lower = host.trim().toLowerCase();
  for (const provider of ['github', 'gitlab', 'bitbucket'] as const) {
    if (lower === KNOWN_FORGE_HOSTS[provider]) return provider;
  }
  if (lower.includes('gitlab')) return 'gitlab';
  if (lower.includes('bitbucket')) return 'bitbucket';
  if (lower.includes('github')) return 'github';
  return null;
}

/** `https://host/owner/repo.git`, `git@host:owner/repo.git`, `ssh://git@host/owner/repo` → target. */
export function forgeTarget(url: string): ForgeTarget | null {
  const text = url.trim();
  if (text.length === 0 || /\s/.test(text)) return null;
  let host: string;
  let path: string;
  if (text.includes('://')) {
    const afterScheme = text.slice(text.indexOf('://') + 3);
    const slash = afterScheme.indexOf('/');
    if (slash < 0) return null;
    const authority = afterScheme.slice(0, slash);
    host =
      (authority.includes('@') ? authority.slice(authority.indexOf('@') + 1) : authority).split(':')[0] ?? '';
    path = afterScheme.slice(slash + 1);
  } else if (text.includes(':')) {
    const [authority, rest] = splitOnce(text, ':');
    if (authority.includes('/')) return null;
    host = (authority.includes('@') ? authority.slice(authority.indexOf('@') + 1) : authority).toLowerCase();
    path = rest;
  } else {
    return null;
  }
  host = host.toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
  const cleaned = path
    .replace(/^\/+/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  const segments = cleaned.split('/').filter((segment) => segment.length > 0);
  // Owner / repo name only contain safe characters (they end up in API URLs — Rust re-validates before calling).
  const safe = /^[A-Za-z0-9._-]{1,100}$/;
  if (
    segments.length < 2 ||
    !segments.every((segment) => safe.test(segment) && segment !== '.' && segment !== '..')
  ) {
    return null;
  }
  const [owner = '', ...rest] = segments;
  // GitLab has subgroups (`group/sub/repo`): the owner is the root group (which picks the account) and the repo is the rest (the project path).
  return { host, provider: providerOfHost(host), owner, repo: rest.join('/'), url: text };
}

function splitOnce(text: string, separator: string): [string, string] {
  const index = text.indexOf(separator);
  return [text.slice(0, index), text.slice(index + 1)];
}

/** Remotes in preference order: `origin`, then the first remote. */
export function preferredRemote<T extends { name: string; fetchUrl: string }>(
  remotes: readonly T[],
): T | null {
  return remotes.find((remote) => remote.name === 'origin') ?? remotes[0] ?? null;
}

/** Target of an opened repo: includes the remote name (`origin`…) it was read from. */
export interface RepoForgeTarget extends ForgeTarget {
  remote: string;
}

/** Target of a repo given its remotes; `null` when the preferred remote doesn't talk to a host the app recognises. */
export function repoForgeTarget(
  remotes: readonly { name: string; fetchUrl: string }[],
): RepoForgeTarget | null {
  const remote = preferredRemote(remotes);
  const target = remote ? forgeTarget(remote.fetchUrl) : null;
  return remote && target ? { ...target, remote: remote.name } : null;
}

/** Commit page on the web (GitHub / GitLab / Bitbucket, self-hosted too); `null` when the host is unrecognised. */
export function commitWebUrl(target: ForgeTarget, sha: string): string | null {
  if (!/^[0-9a-f]{4,64}$/i.test(sha)) return null;
  const base = `https://${target.host}/${target.owner}/${target.repo}`;
  switch (target.provider) {
    case 'github':
      return `${base}/commit/${sha}`;
    case 'gitlab':
      return `${base}/-/commit/${sha}`;
    case 'bitbucket':
      return `${base}/commits/${sha}`;
    default:
      return null;
  }
}
