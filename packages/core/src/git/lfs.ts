// Git LFS: đọc mẫu đang track trong `.gitattributes` gốc (không cần git-lfs, không chạy lệnh) và nhận diện file con trỏ LFS.

/** Một mẫu file do LFS quản lý (`<mẫu> filter=lfs …` trong `.gitattributes` ở gốc repo). */
export interface LfsPattern {
  /** Mẫu đúng như trong file (truyền nguyên cho `git lfs untrack`). */
  readonly pattern: string;
  /** Mẫu để hiển thị: git-lfs ghi khoảng trắng thành `[[:space:]]`. */
  readonly display: string;
  /** Có thuộc tính `lockable` (file chỉ-đọc tới khi khoá). */
  readonly lockable: boolean;
}

/** Nội dung một file con trỏ LFS (file thật nằm trên máy chủ LFS). */
export interface LfsPointer {
  readonly oid: string;
  readonly size: number;
}

/** Mẫu được LFS track trong nội dung `.gitattributes`; dòng chú thích, mẫu bị loại (`!filter`) và dòng hỏng bị bỏ qua. */
export function parseLfsPatterns(text: string): LfsPattern[] {
  const result: LfsPattern[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '').trimStart();
    if (line === '' || line.startsWith('#')) continue;
    const parsed = splitPattern(line);
    if (!parsed) continue;
    const attributes = parsed.rest.split(/\s+/).filter((attribute) => attribute !== '');
    if (!attributes.includes('filter=lfs')) continue;
    result.push({
      pattern: parsed.pattern,
      display: parsed.pattern.replaceAll('[[:space:]]', ' '),
      lockable: attributes.includes('lockable'),
    });
  }
  return result;
}

/** Tách mẫu đầu dòng (kể cả mẫu trong nháy kép kiểu C) khỏi phần thuộc tính. */
function splitPattern(line: string): { pattern: string; rest: string } | null {
  if (!line.startsWith('"')) {
    const end = line.search(/\s/);
    return end < 0 ? null : { pattern: line.slice(0, end), rest: line.slice(end) };
  }
  let pattern = '';
  for (let index = 1; index < line.length; index += 1) {
    const char = line.charAt(index);
    if (char === '"') return { pattern, rest: line.slice(index + 1) };
    if (char === '\\' && index + 1 < line.length) {
      index += 1;
      const escaped = line.charAt(index);
      pattern += escaped === 't' ? '\t' : escaped === 'n' ? '\n' : escaped;
      continue;
    }
    pattern += char;
  }
  return null;
}

const POINTER_VERSION = 'version https://git-lfs.github.com/spec/v1';

/** Nội dung là file con trỏ LFS (bản spec v1: vài dòng `khoá giá trị`, có `oid sha256:` và `size`)? */
export function parseLfsPointer(text: string): LfsPointer | null {
  if (text.length > 1024 || !text.startsWith(POINTER_VERSION)) return null;
  const oid = /^oid sha256:([0-9a-f]{64})$/m.exec(text)?.[1];
  const size = /^size (\d+)$/m.exec(text)?.[1];
  if (oid === undefined || size === undefined) return null;
  return { oid, size: Number(size) };
}
