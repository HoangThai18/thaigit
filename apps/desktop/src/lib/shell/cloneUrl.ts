// Clone URL validation on the UI side (the Rust core re-checks per git-policy): reject command-running
// transports (`ext::`, `fd::`) and URLs starting with `-` (parsed as an option); warn about URLs carrying a
// password / token (it would sit verbatim in `.git/config`); guess the folder name like `git clone` does.

import { vi } from '../strings.vi.ts';

export type CloneUrlCheck =
  | {
      readonly ok: true;
      /** "github.com" · "gitlab.example.com:2222" · `vi.welcome.cloneLocalFolder` ("a folder on this machine"). */
      readonly host: string;
      /** "HoangThai18/thaigit". */
      readonly path: string;
      readonly hasCredentials: boolean;
      readonly defaultName: string;
    }
  | { readonly ok: false; readonly reason: 'empty' | 'dangerous' | 'invalid' };

/** Default folder name: the last path segment with ".git" and trailing "/" stripped. */
export function defaultDirectoryName(url: string): string {
  const trimmed = url
    .trim()
    .replace(/[/\\]+$/, '')
    .replace(/\.git$/i, '');
  const last =
    trimmed
      .split(/[/\\:]/)
      .filter(Boolean)
      .pop() ?? '';
  const cleaned = last.replace(/[\0-\x1f<>:"|?*]/g, '').replace(/^\.+/, '');
  return cleaned === '' ? 'repo' : cleaned;
}

export function checkCloneUrl(input: string): CloneUrlCheck {
  const url = input.trim();
  if (url === '') return { ok: false, reason: 'empty' };
  if (url.startsWith('-') || /^(ext|fd)::/i.test(url) || /[\0\r\n]/.test(url)) {
    return { ok: false, reason: 'dangerous' };
  }
  const defaultName = defaultDirectoryName(url);
  // https://, http://, ssh://, git://, file://
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url);
  if (scheme) {
    const protocol = scheme[1]?.toLowerCase();
    if (!['https', 'http', 'ssh', 'git', 'file'].includes(protocol ?? ''))
      return { ok: false, reason: 'invalid' };
    try {
      const parsed = new URL(url);
      const host = protocol === 'file' ? vi.welcome.cloneLocalFolder : parsed.host;
      if (protocol !== 'file' && host === '') return { ok: false, reason: 'invalid' };
      return {
        ok: true,
        host,
        path: decodeURIComponent(parsed.pathname)
          .replace(/^\/+/, '')
          .replace(/\.git$/i, ''),
        hasCredentials:
          parsed.password !== '' || (protocol?.startsWith('http') === true && parsed.username !== ''),
        defaultName,
      };
    } catch {
      return { ok: false, reason: 'invalid' };
    }
  }
  // scp style: git@github.com:owner/repo.git
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(url);
  if (scp && !/^[a-z]:[\\/]/i.test(url)) {
    return {
      ok: true,
      host: scp[1] ?? '',
      path: (scp[2] ?? '').replace(/^\/+/, '').replace(/\.git$/i, ''),
      hasCredentials: false,
      defaultName,
    };
  }
  // Local path (/a/b, C:\a\b, ../a).
  if (/^(\/|~|\.{1,2}[\\/]|[a-z]:[\\/])/i.test(url)) {
    return { ok: true, host: vi.welcome.cloneLocalFolder, path: url, hasCredentials: false, defaultName };
  }
  return { ok: false, reason: 'invalid' };
}
