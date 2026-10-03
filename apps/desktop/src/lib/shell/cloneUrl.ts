// Kiểm URL clone ở phía giao diện (lõi Rust kiểm lại theo git-policy): từ chối transport chạy lệnh (`ext::`, `fd::`), URL
// bắt đầu bằng "-" (bị hiểu thành tuỳ chọn); cảnh báo URL chứa mật khẩu / token (sẽ nằm nguyên trong `.git/config`);
// đoán tên thư mục như `git clone`.

export type CloneUrlCheck =
  | {
      readonly ok: true;
      /** "github.com" · "gitlab.example.com:2222" · "thư mục trên máy". */
      readonly host: string;
      /** "HoangThai18/thaigit". */
      readonly path: string;
      readonly hasCredentials: boolean;
      readonly defaultName: string;
    }
  | { readonly ok: false; readonly reason: 'empty' | 'dangerous' | 'invalid' };

/** Tên thư mục mặc định: phần cuối đường dẫn, bỏ ".git" và "/" thừa. */
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
      const host = protocol === 'file' ? 'thư mục trên máy' : parsed.host;
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
  // Kiểu scp: git@github.com:owner/repo.git
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
  // Đường dẫn trên máy (/a/b, C:\a\b, ../a).
  if (/^(\/|~|\.{1,2}[\\/]|[a-z]:[\\/])/i.test(url)) {
    return { ok: true, host: 'thư mục trên máy', path: url, hasCredentials: false, defaultName };
  }
  return { ok: false, reason: 'invalid' };
}
