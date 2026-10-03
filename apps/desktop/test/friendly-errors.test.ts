// Quy tắc của app: giao diện không bao giờ hiện lỗi thô (stderr của git, message của Error, mã lỗi OS, stack trace).
import { describe, expect, it } from 'vitest';
import { AdapterError, CancelledError, GitError, RepositoryError } from '@thaigit/core';
import { friendlyError } from '../src/lib/errors/friendly.ts';
import { CommandFailure } from '../src/lib/ipc/errors.ts';

function git(stderr: string): GitError {
  return new GitError(['push', 'origin'], 1, '', stderr);
}

describe('friendlyError', () => {
  it('lỗi git quen thuộc → câu dễ hiểu, không chứa stderr', () => {
    const cases: [string, RegExp][] = [
      ["fatal: Authentication failed for 'https://github.com/x/y.git/'", /từ chối đăng nhập/],
      ["fatal: unable to access 'https://x/': Could not resolve host: x", /Không kết nối được/],
      ['remote: Repository not found.\nfatal: repository not found', /Không tìm thấy repository trên remote/],
      ["fatal: Unable to create '/r/.git/index.lock': File exists.", /file khoá \.lock/],
      ['error: Your local changes to the following files would be overwritten by checkout', /chưa commit/],
      ['CONFLICT (content): Merge conflict in a.txt', /xung đột/],
      [' ! [rejected]        main -> main (fetch first)', /pull trước/],
      ["error: the branch 'x' is not fully merged", /chưa được merge/],
      ['Author identity unknown\n*** Please tell me who you are.', /user\.name/],
      ['error: gpg failed to sign the data', /ký được commit/],
      ['error: open("a"): Permission denied', /quyền truy cập/],
    ];
    for (const [stderr, expected] of cases) {
      const message = friendlyError(git(stderr));
      expect(message, stderr).toMatch(expected);
      expect(message).not.toContain('fatal');
      expect(message).not.toContain('error:');
    }
    expect(friendlyError(git('fatal: something nobody expected'))).toMatch(/Nhật ký lệnh git/);
  });

  it('lỗi của lõi Rust / bộ chuyển theo mã, không dùng message gốc', () => {
    expect(friendlyError(new CommandFailure('io', 'Os { code: 13, kind: PermissionDenied }'))).toMatch(/ổ đĩa/);
    expect(friendlyError(new CommandFailure('git-missing', 'program not found'))).toMatch(/cài Git/);
    expect(friendlyError(new CommandFailure('busy', 'opId x'))).toMatch(/đang bận/);
    expect(friendlyError(new AdapterError('conflict', '"a" đã bị thay đổi bên ngoài'))).toMatch(/thay đổi ở nơi khác/);
    expect(friendlyError(new CommandFailure('internal', 'thread panicked at src/x.rs:12'))).not.toContain('panicked');
  });

  it('lỗi khác của core và exception JS', () => {
    expect(friendlyError(new CancelledError(130))).toBe('Thao tác đã được huỷ.');
    expect(friendlyError(new RepositoryError('notARepository', '/tmp/x'))).toBe('Thư mục này không phải repository git.');
    const unexpected = friendlyError(new TypeError("Cannot read properties of undefined (reading 'length')"));
    expect(unexpected).toMatch(/không mong muốn/);
    expect(friendlyError(undefined)).toBe(unexpected);
    expect(friendlyError({ code: 'không-có' })).toBe(unexpected);
  });
});
