// API công khai của `@thaigit/core` (không phụ thuộc giao diện). Bộ chuyển cho Node nằm ở `@thaigit/core/node`.

export * from './ports/index.ts';
export { AppVersion } from './version.ts';
export * from './git/index.ts';
export * from './diff/index.ts';
export * from './graph/index.ts';
export {
  decodeUtf8Lossy,
  decodeUtf8Strict,
  detectLineEnding,
  hasUtf8Bom,
  isValidUtf8,
  unquoteGitPath,
  type LineEnding,
} from './support/text.ts';
