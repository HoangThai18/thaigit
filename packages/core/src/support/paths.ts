// Pure string path helpers (no `node:` imports) so they run in workers and the webview. Understand both `/` and `\` (Windows).

/** Convert `\` to `/`. */
export function toPosix(path: string): string {
  return path.replaceAll('\\', '/');
}

/** Absolute path: `/x`, `\x`, `C:\x`, `C:/x`, `\\server\share`. (A relative drive spec like `C:x` does not count.) */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(path);
}

function trimTrailingSeparators(path: string): string {
  let end = path.length;
  while (end > 1 && (path[end - 1] === '/' || path[end - 1] === '\\')) end--;
  return path.slice(0, end);
}

/** OS path basename (a repo root, …): drops the trailing separator and understands both `/` and `\`. */
export function osBasename(path: string): string {
  const trimmed = trimTrailingSeparators(path);
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return index < 0 ? trimmed : trimmed.slice(index + 1);
}

/** File name of a path in git terms (always `/`; `\` is a legal filename character on macOS/Linux). */
export function gitBasename(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? path : path.slice(index + 1);
}

/** Containing directory in git terms; a file at the root yields "". */
export function gitDirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

/**
 * Remainder of `path` below `base` ("" when equal), or null when it lies outside.
 * Comparison respects directory boundaries (`/a/repo2` is not inside `/a/repo`); `ignoreCase` covers NTFS/APFS volumes.
 */
export function relativeTo(base: string, path: string, ignoreCase = false): string | null {
  const fold = (value: string) => (ignoreCase ? value.toLowerCase() : value);
  const normalizedBase = trimTrailingSeparators(toPosix(base));
  const normalizedPath = toPosix(path);
  const foldedBase = fold(normalizedBase);
  const foldedPath = fold(normalizedPath);
  if (foldedPath === foldedBase) return '';
  const prefix = normalizedBase.endsWith('/') ? foldedBase : `${foldedBase}/`;
  return foldedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : null;
}

/**
 * Check a relative path for RepoFs: returns the rejection reason, or null when it is acceptable.
 * Always rejected: empty, NUL, absolute, empty/`.`/`..` segments. `windows` adds `\`, `:` (drive letters, ADS), and
 * segments ending in a dot or space (Windows strips those, so they can escape the scope or point at the wrong file).
 */
export function checkRelativePath(relative: string, windows: boolean): string | null {
  if (relative === '') return 'đường dẫn rỗng';
  if (relative.includes('\0')) return 'đường dẫn chứa ký tự NUL';
  if (isAbsolutePath(relative)) return 'đường dẫn tuyệt đối';
  if (windows && (relative.includes('\\') || relative.includes(':')))
    return 'đường dẫn chứa ký tự không hợp lệ trên Windows';
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.' || segment === '..')
      return 'đường dẫn chứa đoạn rỗng, "." hoặc ".."';
    if (windows && /[. ]$/.test(segment)) return 'đoạn đường dẫn kết thúc bằng dấu chấm/khoảng trắng';
  }
  return null;
}

/**
 * Does any segment read `.git` (case-insensitive; trailing dots/spaces and the short NTFS name `GIT~1` are ignored)?
 * RepoFs never reads, writes or moves files inside `.git` through the working tree (writing `.git/hooks/*` means running
 * arbitrary commands).
 */
export function hasGitComponent(relative: string): boolean {
  return relative.split(/[\\/]/).some((segment) => {
    const folded = segment.replace(/[. ]+$/, '').toLowerCase();
    return folded === '.git' || folded === 'git~1';
  });
}
