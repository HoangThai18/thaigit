// Chuyển MỌI lỗi (lõi Rust, git, core, exception của JS) thành một câu tiếng Việt dễ hiểu. Quy tắc của app: giao diện không bao
// giờ hiện stderr của git, message gốc của Error, mã lỗi hệ điều hành hay stack trace — người dùng chỉ thấy câu ở đây. Chi tiết
// kỹ thuật vẫn xem được trong "Nhật ký lệnh git" (người dùng tự mở).

import { CancelledError, GitError, RepositoryError } from '@thaigit/core';
import { AiFailure } from '../ai/client.ts';
import { vi } from '../strings.vi.ts';

const text = vi.errors.friendly;

/** Mẫu lỗi git quen thuộc → câu thân thiện (theo thứ tự ưu tiên; so không phân biệt hoa thường). */
const GIT_PATTERNS: readonly (readonly [readonly string[], string])[] = [
  [['Please tell me who you are', 'empty ident', 'unable to auto-detect email address'], text.identity],
  [
    [
      'Authentication failed',
      'could not read Username',
      'could not read Password',
      'Permission denied (publickey',
      'returned error: 401',
      'returned error: 403',
      'terminal prompts disabled',
      'Invalid username or password',
    ],
    text.auth,
  ],
  [
    ['Repository not found', 'does not appear to be a git repository', 'returned error: 404'],
    text.remoteMissing,
  ],
  [
    [
      'Could not resolve host',
      'Connection timed out',
      'Connection refused',
      'Failed to connect',
      'unable to access',
      'Network is unreachable',
    ],
    text.network,
  ],
  [[".lock': File exists", 'index.lock', 'Unable to create', 'cannot lock ref'], text.lockFile],
  [
    ['would be overwritten', 'Please commit your changes or stash them', 'Your local changes'],
    text.localChanges,
  ],
  [
    ['CONFLICT', 'Resolve all conflicts', 'could not apply', 'unmerged files', 'you need to resolve'],
    text.gitConflict,
  ],
  [['Not possible to fast-forward', 'divergent'], text.diverged],
  [['[rejected]', 'non-fast-forward', 'fetch first', 'stale info'], text.rejected],
  [['not fully merged'], text.notMerged],
  [['no upstream', 'has no upstream'], text.noUpstream],
  [['nothing to commit', 'nothing added to commit'], text.nothingToCommit],
  [['already exists'], text.alreadyExists],
  [['gpg failed', 'failed to sign', 'signing failed', 'error: Load key'], text.signing],
  [['hook declined', 'pre-commit hook', 'pre-push hook', 'commit-msg hook'], text.hook],
  [['No space left'], text.diskFull],
  [['Permission denied', 'Access is denied'], text.permission],
  [
    [
      'unknown revision',
      'invalid reference',
      'not a valid',
      'did not match any',
      'bad revision',
      'ambiguous argument',
    ],
    text.unknownRef,
  ],
];

const CODE_TEXT: Readonly<Record<string, string>> = {
  policy: text.policy,
  'not-found': text.notFound,
  'out-of-scope': text.outOfScope,
  conflict: text.conflict,
  busy: text.busy,
  io: text.io,
  'git-missing': text.gitMissing,
  'git-too-old': text.gitTooOld,
  untrusted: text.untrusted,
  internal: text.unexpected,
};

function friendlyGitError(error: GitError): string {
  for (const [needles, message] of GIT_PATTERNS) {
    if (needles.some((needle) => error.contains(needle))) return message;
  }
  return text.gitFailed;
}

/** Lỗi của máy chủ AI (mã trong contracts) → câu thân thiện. */
function friendlyAiFailure(error: AiFailure): string {
  const ai = vi.ai.errors;
  const wait = error.retryAfter ?? 30;
  switch (error.code) {
    case 'quota_exhausted':
      return ai.quota_exhausted;
    case 'ip_rate_limited':
      return ai.ip_rate_limited(wait);
    case 'ai_busy':
      return ai.ai_busy(wait);
    case 'ai_unavailable':
      return ai.ai_unavailable;
    case 'ai_disabled':
      return ai.ai_disabled;
    case 'too_large':
      return ai.too_large;
    case 'invalid_token':
      return ai.invalid_token;
    case 'network':
      return ai.network;
    case 'cancelled':
      return text.cancelled;
    case 'empty':
      return ai.empty;
    default:
      return ai.server;
  }
}

/** Câu thân thiện cho một lỗi bất kỳ. */
export function friendlyError(error: unknown): string {
  if (error instanceof CancelledError) return text.cancelled;
  if (error instanceof AiFailure) return friendlyAiFailure(error);
  if (error instanceof GitError) return friendlyGitError(error);
  if (error instanceof RepositoryError) {
    switch (error.kind) {
      case 'notARepository':
        return text.notARepository;
      case 'bareRepository':
        return text.bareRepository;
      case 'invalidName':
        return text.invalidName;
    }
  }
  // Lỗi chuẩn hoá của lõi Rust (CommandFailure) và của bộ chuyển Node (AdapterError) đều có `code`.
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code in CODE_TEXT) return CODE_TEXT[code] ?? text.unexpected;
  return text.unexpected;
}
