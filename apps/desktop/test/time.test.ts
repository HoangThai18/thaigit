import { describe, expect, it } from 'vitest';
import { formatAbsolute, formatCommitTime, formatRelative } from '../src/lib/format/time.ts';

const NOW = 1_700_000_000;

describe('formatRelative', () => {
  it('dưới 1 phút (cả hai phía) là "vừa xong"', () => {
    expect(formatRelative(NOW - 5, NOW)).toBe('vừa xong');
    expect(formatRelative(NOW - 59, NOW)).toBe('vừa xong');
    expect(formatRelative(NOW + 30, NOW)).toBe('vừa xong');
  });

  it('chọn đơn vị lớn nhất, làm tròn xuống', () => {
    expect(formatRelative(NOW - 60, NOW)).toBe('1 phút trước');
    expect(formatRelative(NOW - 59 * 60, NOW)).toBe('59 phút trước');
    expect(formatRelative(NOW - 3 * 3600 - 100, NOW)).toBe('3 giờ trước');
    expect(formatRelative(NOW - 86_400, NOW)).toBe('1 ngày trước');
    expect(formatRelative(NOW - 6 * 86_400, NOW)).toBe('6 ngày trước');
    expect(formatRelative(NOW - 15 * 86_400, NOW)).toBe('2 tuần trước');
    expect(formatRelative(NOW - 90 * 86_400, NOW)).toBe('3 tháng trước');
    expect(formatRelative(NOW - 5 * 365 * 86_400, NOW)).toBe('5 năm trước');
  });

  it('commit ở tương lai (giờ máy lệch) dùng "sau …"', () => {
    expect(formatRelative(NOW + 2 * 3600, NOW)).toBe('sau 2 giờ');
  });
});

describe('formatAbsolute', () => {
  it('dd/MM/yyyy HH:mm theo giờ máy, có đệm số 0', () => {
    const seconds = new Date(2024, 8, 5, 7, 3).getTime() / 1000;
    expect(formatAbsolute(seconds)).toBe('05/09/2024 07:03');
  });
});

describe('formatCommitTime', () => {
  it('tương đối khi dưới 7 ngày và đang bật', () => {
    expect(formatCommitTime(NOW - 3600, { relative: true, nowSeconds: NOW })).toBe('1 giờ trước');
  });

  it('từ 7 ngày trở đi dùng ngày giờ tuyệt đối', () => {
    const old = NOW - 8 * 86_400;
    expect(formatCommitTime(old, { relative: true, nowSeconds: NOW })).toBe(formatAbsolute(old));
  });

  it('tắt tương đối → luôn tuyệt đối', () => {
    expect(formatCommitTime(NOW - 60, { relative: false, nowSeconds: NOW })).toBe(formatAbsolute(NOW - 60));
  });

  it('commit ở tương lai quá 1 phút → tuyệt đối (như Swift)', () => {
    const future = NOW + 3600;
    expect(formatCommitTime(future, { relative: true, nowSeconds: NOW })).toBe(formatAbsolute(future));
  });
});
