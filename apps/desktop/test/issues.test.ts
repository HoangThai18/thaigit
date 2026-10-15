import type { ForgeIssue } from '@thaigit/contracts';
import { describe, expect, it } from 'vitest';
import { filterIssues, issueBranchName } from '../src/lib/forge/issues.ts';

function issue(number: string, title: string, extra: Partial<ForgeIssue> = {}): ForgeIssue {
  return {
    host: 'github.com',
    number,
    title,
    author: 'an',
    webUrl: `https://github.com/acme/app/issues/${number}`,
    updatedAt: '',
    comments: 0,
    labels: [],
    assignees: [],
    ...extra,
  };
}

describe('issue', () => {
  it('gợi ý tên nhánh từ số và tiêu đề issue, bỏ dấu tiếng Việt', () => {
    expect(issueBranchName(issue('42', 'Lỗi đăng nhập bằng Google!'))).toBe(
      'issue/42-loi-dang-nhap-bang-google',
    );
    expect(issueBranchName(issue('7', '!!!'))).toBe('issue/7');
    const long = issueBranchName(issue('9', 'a'.repeat(30) + ' ' + 'b'.repeat(30)));
    expect(long.length).toBeLessThanOrEqual('issue/9-'.length + 40);
    expect(long.endsWith('-')).toBe(false);
  });

  it('lọc theo số, tiêu đề, người mở và nhãn, không phân biệt dấu', () => {
    const items = [
      issue('1', 'Lỗi đăng nhập', { labels: ['bug'] }),
      issue('2', 'Thêm giao diện tối', { author: 'binh' }),
    ];
    expect(filterIssues(items, 'dang nhap').map((item) => item.number)).toEqual(['1']);
    expect(filterIssues(items, '#2').map((item) => item.number)).toEqual(['2']);
    expect(filterIssues(items, 'BUG').map((item) => item.number)).toEqual(['1']);
    expect(filterIssues(items, 'binh toi').map((item) => item.number)).toEqual(['2']);
    expect(filterIssues(items, '  ')).toHaveLength(2);
  });
});
