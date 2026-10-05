// UI-side clone URL validation: block command-running transports, warn about URLs carrying a token, guess the folder name.
import { describe, expect, it } from 'vitest';
import { checkCloneUrl, defaultDirectoryName } from '../src/lib/shell/cloneUrl.ts';

describe('checkCloneUrl', () => {
  it('nhận HTTPS, SSH kiểu scp, ssh://, đường dẫn trên máy', () => {
    expect(checkCloneUrl('https://github.com/HoangThai18/thaigit.git')).toEqual({
      ok: true,
      host: 'github.com',
      path: 'HoangThai18/thaigit',
      hasCredentials: false,
      defaultName: 'thaigit',
    });
    expect(checkCloneUrl('git@github.com:HoangThai18/thaigit.git')).toMatchObject({
      ok: true,
      host: 'github.com',
      path: 'HoangThai18/thaigit',
    });
    expect(checkCloneUrl('ssh://git@gitlab.example.com:2222/team/app.git')).toMatchObject({
      ok: true,
      host: 'gitlab.example.com:2222',
    });
    expect(checkCloneUrl('/Users/thai/repos/demo')).toMatchObject({ ok: true, defaultName: 'demo' });
    expect(checkCloneUrl('C:\\repos\\demo')).toMatchObject({ ok: true, defaultName: 'demo' });
  });

  it('chặn ext::, fd::, URL bắt đầu bằng "-"; cảnh báo token trong URL', () => {
    expect(checkCloneUrl('ext::sh -c touch% /tmp/pwned')).toEqual({ ok: false, reason: 'dangerous' });
    expect(checkCloneUrl('fd::3')).toEqual({ ok: false, reason: 'dangerous' });
    expect(checkCloneUrl('--upload-pack=touch /tmp/x')).toEqual({ ok: false, reason: 'dangerous' });
    expect(checkCloneUrl('ftp://x/y')).toEqual({ ok: false, reason: 'invalid' });
    expect(checkCloneUrl('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(checkCloneUrl('https://ghp_token123@github.com/a/b.git')).toMatchObject({
      ok: true,
      hasCredentials: true,
    });
    expect(checkCloneUrl('https://user:pass@example.com/a/b.git')).toMatchObject({ hasCredentials: true });
  });

  it('tên thư mục mặc định', () => {
    expect(defaultDirectoryName('https://github.com/a/b.git/')).toBe('b');
    expect(defaultDirectoryName('git@host:team/x.y.git')).toBe('x.y');
    expect(defaultDirectoryName('https://host/')).toBe('host');
  });
});
