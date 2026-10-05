// Repo này nói chuyện với máy chủ nào: đọc `owner` + `repo` từ URL remote (Rust cũng kiểm lại khi gọi API). Dùng cho phần
// Pull Request / Merge Request và menu "Tài khoản cho repo này".

import { KNOWN_FORGE_HOSTS, type ForgeProvider } from '@thaigit/contracts';

export interface ForgeTarget {
  host: string;
  provider: ForgeProvider | null;
  /** Segment đầu của đường dẫn (user / tổ chức / nhóm gốc). */
  owner: string;
  /** Phần còn lại sau owner, bỏ `.git` (`app`, hoặc `sub/app` với nhóm con của GitLab). */
  repo: string;
  /** URL remote đầy đủ (chỉ để hiển thị). */
  url: string;
}

/** Provider đoán từ host: ba host chính thức, rồi tên có chữ gitlab / bitbucket / github (máy chủ tự host); còn lại `null`. */
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
  // Owner / tên repo chỉ gồm ký tự an toàn (được dùng trong URL API — Rust kiểm lại trước khi gọi).
  const safe = /^[A-Za-z0-9._-]{1,100}$/;
  if (
    segments.length < 2 ||
    !segments.every((segment) => safe.test(segment) && segment !== '.' && segment !== '..')
  ) {
    return null;
  }
  const [owner = '', ...rest] = segments;
  // GitLab có nhóm con (`group/sub/repo`): owner là nhóm gốc (chọn tài khoản), repo là phần còn lại (đường dẫn của project).
  return { host, provider: providerOfHost(host), owner, repo: rest.join('/'), url: text };
}

function splitOnce(text: string, separator: string): [string, string] {
  const index = text.indexOf(separator);
  return [text.slice(0, index), text.slice(index + 1)];
}

/** Remote theo thứ tự ưu tiên: `origin`, rồi remote đầu tiên. */
export function preferredRemote<T extends { name: string; fetchUrl: string }>(
  remotes: readonly T[],
): T | null {
  return remotes.find((remote) => remote.name === 'origin') ?? remotes[0] ?? null;
}

/** Target của một repo đã mở: kèm tên remote (`origin`…) mà target đó đọc ra. */
export interface RepoForgeTarget extends ForgeTarget {
  remote: string;
}

/** Target của repo từ danh sách remote; `null` nếu remote ưu tiên không nói chuyện với máy chủ app nhận ra. */
export function repoForgeTarget(
  remotes: readonly { name: string; fetchUrl: string }[],
): RepoForgeTarget | null {
  const remote = preferredRemote(remotes);
  const target = remote ? forgeTarget(remote.fetchUrl) : null;
  return remote && target ? { ...target, remote: remote.name } : null;
}

/** Trang commit trên web (GitHub / GitLab / Bitbucket, kể cả tự host); `null` nếu không nhận ra máy chủ. */
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
