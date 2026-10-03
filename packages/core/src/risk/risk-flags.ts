// Cờ rủi ro trước khi commit (không AI): xét các thay đổi chưa commit theo luật — xoá / bỏ qua test, đổi thư viện phụ thuộc,
// đổi CI, file lớn, bí mật (dùng lại bộ quét của AI). Chỉ cảnh báo, không chặn commit; kết quả chỉ có ĐƯỜNG DẪN, không bao giờ
// có nội dung bí mật. Ca kiểm thử dùng chung với app Swift: packages/contracts/risk-rules.vectors.json.

import { classifyPath, findSecret } from '../ai/secret-scan.ts';

export const RISK_CODES = [
  'tests-removed',
  'tests-skipped',
  'deps-changed',
  'ci-changed',
  'large-file',
  'secret',
] as const;
export type RiskCode = (typeof RISK_CODES)[number];

export interface RiskInput {
  readonly path: string;
  readonly status: 'added' | 'modified' | 'deleted';
  /** Dòng được thêm (không kèm dấu `+`); rỗng khi không đọc nội dung. */
  readonly addedLines: readonly string[];
  /** Kích thước file hiện tại (byte); null = không rõ. */
  readonly size: number | null;
}

export interface RiskFlag {
  readonly code: RiskCode;
  readonly paths: readonly string[];
}

/** Trên mức này là "file lớn". */
export const LARGE_FILE_BYTES = 1024 * 1024;

const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'specs']);
const TEST_FILE = [/\.(?:test|spec)\.[a-z0-9]+$/, /_test\.[a-z0-9]+$/, /^test_.+\.py$/];
const TEST_SKIP = [
  /\b(?:it|test|describe|context|suite)\.(?:skip|only)\s*\(/,
  /\bx(?:it|test|describe)\s*\(/,
  /#\[ignore\]/,
  /@pytest\.mark\.skip/,
  /@(?:Disabled|Ignore)\b/,
  /\bXCTSkip\b/,
];

const DEPS_FILES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'cargo.toml',
  'cargo.lock',
  'package.swift',
  'package.resolved',
  'go.mod',
  'go.sum',
  'pyproject.toml',
  'poetry.lock',
  'pipfile',
  'pipfile.lock',
  'uv.lock',
  'gemfile',
  'gemfile.lock',
  'composer.json',
  'composer.lock',
  'build.gradle',
  'build.gradle.kts',
  'pom.xml',
  'podfile',
  'podfile.lock',
  'pubspec.yaml',
  'pubspec.lock',
]);
const DEPS_PATTERN = /^requirements.*\.txt$/;

const CI_NAMES = [
  /^\.gitlab-ci\.ya?ml$/,
  /^jenkinsfile$/,
  /^azure-pipelines\.ya?ml$/,
  /^dockerfile(?:\..+)?$/,
  /\.dockerfile$/,
  /^docker-compose.*\.ya?ml$/,
  /^compose\.ya?ml$/,
];

function lowerSegments(path: string): string[] {
  return path.toLowerCase().split('/');
}

export function isTestPath(path: string): boolean {
  const segments = lowerSegments(path);
  const name = segments[segments.length - 1] ?? '';
  return (
    segments.slice(0, -1).some((segment) => TEST_DIRS.has(segment)) || TEST_FILE.some((p) => p.test(name))
  );
}

function isDepsFile(path: string): boolean {
  const name = lowerSegments(path).pop() ?? '';
  return DEPS_FILES.has(name) || DEPS_PATTERN.test(name);
}

function isCiFile(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.startsWith('.github/workflows/') || lower.startsWith('.circleci/')) return true;
  const name = lowerSegments(path).pop() ?? '';
  return CI_NAMES.some((pattern) => pattern.test(name));
}

function matches(code: RiskCode, file: RiskInput): boolean {
  const present = file.status !== 'deleted';
  switch (code) {
    case 'tests-removed':
      return file.status === 'deleted' && isTestPath(file.path);
    case 'tests-skipped':
      return (
        present &&
        isTestPath(file.path) &&
        file.addedLines.some((line) => TEST_SKIP.some((p) => p.test(line)))
      );
    case 'deps-changed':
      return isDepsFile(file.path);
    case 'ci-changed':
      return isCiFile(file.path);
    case 'large-file':
      return present && file.size !== null && file.size > LARGE_FILE_BYTES;
    case 'secret':
      return (
        present &&
        (classifyPath(file.path) === 'sensitive' || file.addedLines.some((line) => findSecret(line) !== null))
      );
  }
}

/** Các cờ theo thứ tự `RISK_CODES`, mỗi cờ kèm đường dẫn đã sắp xếp; không có gì đáng ngại → []. */
export function detectRisks(files: readonly RiskInput[]): RiskFlag[] {
  const flags: RiskFlag[] = [];
  for (const code of RISK_CODES) {
    const paths = files
      .filter((file) => matches(code, file))
      .map((file) => file.path)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (paths.length > 0) flags.push({ code, paths });
  }
  return flags;
}
