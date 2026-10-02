import { describe, expect, it } from 'vitest';
import { AppVersion } from '../src/index.ts';

const v = (text: string) => {
  const version = AppVersion.parse(text);
  if (!version) throw new Error(`không parse được ${text}`);
  return version;
};

describe('AppVersion', () => {
  it('so sánh theo từng phần số (giống bản Swift)', () => {
    expect(v('1.0.10').compare(v('1.0.9'))).toBe(1);
    expect(v('v1.1').compare(v('1.1.0'))).toBe(0);
    expect(v('2').compare(v('1.9.9'))).toBe(1);
    expect(v('1.0.0').compare(v('1.0.1'))).toBe(-1);
  });

  it('từ chối chuỗi sai định dạng', () => {
    for (const bad of ['', '1..2', 'abc', '1.2.3.4.5', '+1', '1.-2', '1.2 beta']) {
      expect(AppVersion.parse(bad), bad).toBeNull();
    }
  });
});
