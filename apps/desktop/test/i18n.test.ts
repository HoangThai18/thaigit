// Bản tiếng Anh: cùng hình dạng với tiếng Việt (kiểu `Strings` bắt lúc check; test này bắt thêm lúc chạy), không sót chữ
// tiếng Việt, hàm cùng số tham số và trả về chữ; ngôn ngữ đã lưu đọc đúng, giá trị lạ rơi về tiếng Việt.
import { describe, expect, it } from 'vitest';
import { LOCALE_KEY, LOCALES, readLocale } from '../src/lib/i18n/locale.ts';
import { en } from '../src/lib/strings.en.ts';
import { vi } from '../src/lib/strings.vi.ts';

/** Dấu tiếng Việt (chữ thường lẫn hoa) — bản tiếng Anh không được có, trừ tên ngôn ngữ "Tiếng Việt" / "Ngôn ngữ". */
const VIETNAMESE = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const ALLOWED = new Set(['languageVi', 'language']);

type Leaf = { path: string; key: string; value: unknown };

function leaves(value: unknown, path = ''): Leaf[] {
  if (value === null || typeof value !== 'object') return [{ path, key: path.split('.').pop() ?? '', value }];
  return Object.entries(value).flatMap(([key, child]) => leaves(child, path ? `${path}.${key}` : key));
}

/** Gọi thử hàm chuỗi: tham số có thể là chữ, số, mảng hay cờ — thử lần lượt tới khi không lỗi. */
function sample(fn: (...args: never[]) => unknown): unknown {
  for (const value of ['main', 2, ['origin'], true]) {
    try {
      return fn(...(Array.from({ length: fn.length }, () => value) as never[]));
    } catch {
      // Sai kiểu tham số: thử kiểu khác.
    }
  }
  throw new Error('không gọi thử được');
}

describe('bản tiếng Anh', () => {
  const english = new Map(leaves(en).map((leaf) => [leaf.path, leaf]));
  const vietnamese = leaves(vi);

  it('có đủ mọi khoá của tiếng Việt và không thừa khoá', () => {
    expect([...english.keys()].sort()).toEqual(vietnamese.map((leaf) => leaf.path).sort());
  });

  it('hàm cùng số tham số, chữ và kết quả không rỗng', () => {
    for (const source of vietnamese) {
      const target = english.get(source.path)?.value;
      if (typeof source.value === 'function') {
        expect(typeof target, source.path).toBe('function');
        const fn = target as (...args: never[]) => unknown;
        expect(fn.length, source.path).toBe((source.value as (...args: never[]) => unknown).length);
        expect(typeof sample(fn), source.path).toBe('string');
      } else {
        expect(typeof target, source.path).toBe('string');
        if (source.value !== '') expect((target as string).trim(), source.path).not.toBe('');
      }
    }
  });

  it('không còn chữ tiếng Việt', () => {
    for (const leaf of english.values()) {
      if (ALLOWED.has(leaf.key)) continue;
      const text =
        typeof leaf.value === 'function' ? sample(leaf.value as (...args: never[]) => unknown) : leaf.value;
      expect(String(text), leaf.path).not.toMatch(VIETNAMESE);
    }
  });

  it('số nhiều tiếng Anh', () => {
    expect(en.inspector.filesChanged(1)).toBe('1 file changed');
    expect(en.inspector.filesChanged(3)).toBe('3 files changed');
    expect(en.time.ago(en.time.hours(1))).toBe('1 hour ago');
    expect(en.staging.commitButton(2, 'main')).toBe('Commit 2 files to main');
  });
});

describe('ngôn ngữ đã lưu', () => {
  const store = (value: string | null) => ({
    getItem: (key: string) => (key === LOCALE_KEY ? value : null),
    setItem() {},
  });

  it('đọc đúng, chưa chọn hoặc giá trị lạ → tiếng Việt', () => {
    expect(readLocale(store('en'))).toBe('en');
    expect(readLocale(store('vi'))).toBe('vi');
    expect(readLocale(store(null))).toBe('vi');
    expect(readLocale(store('fr'))).toBe('vi');
    expect(readLocale(null)).toBe('vi');
    expect(
      readLocale({
        getItem: () => {
          throw new Error('bị chặn');
        },
        setItem() {},
      }),
    ).toBe('vi');
  });

  it('danh sách ngôn ngữ hiện tên bằng chính ngôn ngữ đó', () => {
    expect(LOCALES.map((item) => item.name)).toEqual(['Tiếng Việt', 'English']);
  });
});
