// Tiện ích đường dẫn thuần chuỗi (không `node:`): chạy được trong worker/webview. Hiểu cả `/` lẫn `\` (Windows).

/** Đổi `\` thành `/`. */
export function toPosix(path: string): string {
  return path.replaceAll('\\', '/');
}

/** Đường dẫn tuyệt đối: `/x`, `\x`, `C:\x`, `C:/x`, `\\server\share`. (`C:x` kiểu ổ đĩa tương đối không tính.) */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(path);
}

function trimTrailingSeparators(path: string): string {
  let end = path.length;
  while (end > 1 && (path[end - 1] === '/' || path[end - 1] === '\\')) end--;
  return path.slice(0, end);
}

/** Tên cuối của đường dẫn hệ điều hành (gốc repo…): bỏ dấu phân cách cuối, hiểu cả `/` và `\`. */
export function osBasename(path: string): string {
  const trimmed = trimTrailingSeparators(path);
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return index < 0 ? trimmed : trimmed.slice(index + 1);
}

/** Tên file của đường dẫn trong git (luôn `/`, `\` là ký tự tên file hợp lệ trên macOS/Linux). */
export function gitBasename(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? path : path.slice(index + 1);
}

/** Thư mục chứa của đường dẫn trong git; file ở gốc → "". */
export function gitDirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

/**
 * Phần còn lại của `path` bên dưới `base` ("" nếu bằng nhau), hoặc null nếu nằm ngoài.
 * So khớp theo ranh giới thư mục (`/a/repo2` không nằm trong `/a/repo`); `ignoreCase` cho ổ NTFS/APFS mặc định.
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
 * Kiểm đường dẫn tương đối dùng cho RepoFs: trả lý do từ chối, hoặc null nếu hợp lệ.
 * Luôn từ chối: rỗng, NUL, tuyệt đối, đoạn rỗng/`.`/`..`. `windows` thêm: `\`, `:` (ổ đĩa, ADS), đoạn kết thúc bằng
 * dấu chấm/khoảng trắng (Windows bỏ chúng nên có thể thoát phạm vi hoặc trỏ nhầm file).
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
 * Có đoạn nào là `.git` không (không phân biệt hoa thường; bỏ dấu chấm/khoảng trắng cuối và tên ngắn NTFS `GIT~1`)?
 * RepoFs không bao giờ đọc/ghi/dời file trong `.git` qua đường working tree (ghi `.git/hooks/*` là chạy lệnh tuỳ ý).
 */
export function hasGitComponent(relative: string): boolean {
  return relative.split(/[\\/]/).some((segment) => {
    const folded = segment.replace(/[. ]+$/, '').toLowerCase();
    return folded === '.git' || folded === 'git~1';
  });
}
