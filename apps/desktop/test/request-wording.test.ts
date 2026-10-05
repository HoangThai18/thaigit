import { describe, expect, it } from 'vitest';
import { requestWording } from '../src/lib/forge/wording.ts';

describe('requestWording', () => {
  it('GitLab gọi là Merge Request ở nút, hộp thoại và thông báo', () => {
    const text = requestWording('gitlab');
    expect(text.buttonLabel).toBe('MR');
    expect(text.createFrom('feature/x')).toBe('Tạo Merge Request từ feature/x');
    expect(text.submit).toBe('Tạo Merge Request');
    expect(text.createdToast('12')).toBe('Đã tạo Merge Request !12.');
    expect(text.notPushed('feature/x')).toContain('Merge Request');
    expect(text.buttonTip('feature/x')).toBe('Tạo Merge Request từ nhánh feature/x');
  });

  it('GitHub, Bitbucket và máy chủ chưa rõ gọi là Pull Request', () => {
    for (const provider of ['github', 'bitbucket', null, undefined] as const) {
      const text = requestWording(provider);
      expect(text.buttonLabel).toBe('PR');
      expect(text.createFrom('main')).toBe('Tạo Pull Request từ main');
      expect(text.createdToast('7')).toBe('Đã tạo Pull Request #7.');
      expect(text.buttonNoBranch).toContain('Pull Request');
    }
  });
});
