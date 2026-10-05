// Git LFS: read the tracked patterns from the root `.gitattributes` (no git-lfs needed, no command run) and detect LFS pointer files.

/** A file pattern managed by LFS (`<pattern> filter=lfs …` in the repo root's `.gitattributes`). */
export interface LfsPattern {
  /** Pattern exactly as written in the file (passed through to `git lfs untrack`). */
  readonly pattern: string;
  /** Pattern for display: git-lfs writes spaces as `[[:space:]]`. */
  readonly display: string;
  /** Has the `lockable` attribute (read-only until locked). */
  readonly lockable: boolean;
}

/** Content of an LFS pointer file (the real file lives on the LFS server). */
export interface LfsPointer {
  readonly oid: string;
  readonly size: number;
}

/** Patterns tracked by LFS in the `.gitattributes` content; comment lines, negated patterns (`!filter`) and malformed lines are skipped. */
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

/** Split the leading pattern (including one inside C-style quotes) from the attribute part. */
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

/** Is the content an LFS pointer file (spec v1: a few `key value` lines with `oid sha256:` and `size`)? */
export function parseLfsPointer(text: string): LfsPointer | null {
  if (text.length > 1024 || !text.startsWith(POINTER_VERSION)) return null;
  const oid = /^oid sha256:([0-9a-f]{64})$/m.exec(text)?.[1];
  const size = /^size (\d+)$/m.exec(text)?.[1];
  if (oid === undefined || size === undefined) return null;
  return { oid, size: Number(size) };
}
