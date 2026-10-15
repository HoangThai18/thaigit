import { describe, expect, it } from 'vitest';
import { FEEDBACK_EMAIL, feedbackBody, feedbackMailto } from '../src/lib/feedback/compose.ts';

const labels = {
  subject: (kind: 'bug' | 'idea') => (kind === 'bug' ? '[Gitlane] Báo lỗi' : '[Gitlane] Góp ý'),
  trimmed: '(đã cắt)',
};

function decode(url: string) {
  const parsed = new URL(url);
  return {
    to: decodeURIComponent(parsed.pathname),
    subject: parsed.searchParams.get('subject'),
    body: parsed.searchParams.get('body'),
  };
}

describe('feedback mailto', () => {
  it('soạn thư tới đúng email, tiêu đề theo loại, thân kèm thông tin máy khi được chọn', () => {
    const draft = {
      kind: 'bug' as const,
      message: '  Bấm Push bị treo & mất nút?  ',
      info: 'Phiên bản: 2.6.0',
    };
    const { url, trimmed } = feedbackMailto(draft, labels);
    expect(trimmed).toBe(false);
    expect(decode(url)).toEqual({
      to: FEEDBACK_EMAIL,
      subject: '[Gitlane] Báo lỗi',
      body: 'Bấm Push bị treo & mất nút?\n\n---\nPhiên bản: 2.6.0',
    });
    expect(url).not.toMatch(/\s/);
    expect(feedbackBody({ ...draft, kind: 'idea', info: null })).toBe('Bấm Push bị treo & mất nút?');
  });

  it('nội dung quá dài thì cắt cho vừa 2048 ký tự URL, không vỡ ký tự tiếng Việt', () => {
    const draft = { kind: 'idea' as const, message: 'Ước gì có thêm tính năng 🌟 '.repeat(200), info: null };
    const { url, trimmed } = feedbackMailto(draft, labels);
    expect(trimmed).toBe(true);
    expect(url.length).toBeLessThanOrEqual(2048);
    const body = decode(url).body ?? '';
    expect(body.endsWith('…\n\n(đã cắt)')).toBe(true);
    expect(body.startsWith('Ước gì có thêm tính năng')).toBe(true);
  });
});
