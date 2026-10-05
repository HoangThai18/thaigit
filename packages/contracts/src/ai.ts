/**
 * AI contract between the app and the Thaigit server (`server/`, which forwards to a self-hosted Hermes). The app
 * only sends packaged context (a filtered, secret-scanned diff plus a few recent subjects); prompts live on the
 * server, so tuning them needs no app release.
 *
 * Flow: `POST /v1/ai/install` (only after user consent) returns a token; every later `/v1/ai/*` request carries the
 * three `AI_HEADERS`. Text routes reply with SSE: each frame is `event: <type>` + `data: <JSON>` (see `AiFrame`).
 */

export const AI_HEADERS = {
  installId: 'X-AI-Install-Id',
  token: 'X-AI-Token',
  appVersion: 'X-App-Version',
} as const;

export const AI_FEATURES = ['commit', 'explain', 'pr'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/** Text-generation route per feature. */
export const AI_ROUTES: Record<AiFeature, string> = {
  commit: '/v1/ai/commit-message',
  explain: '/v1/ai/explain-commit',
  pr: '/v1/ai/pr-description',
};

export const AI_ERROR_CODES = [
  'invalid_token',
  'quota_exhausted',
  'ip_rate_limited',
  'ai_busy',
  'ai_unavailable',
  'ai_disabled',
  'too_large',
  'bad_request',
  'internal',
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export const AI_ERROR_STATUS: Record<AiErrorCode, number> = {
  invalid_token: 401,
  quota_exhausted: 429,
  ip_rate_limited: 429,
  ai_busy: 503,
  ai_unavailable: 503,
  ai_disabled: 503,
  too_large: 413,
  bad_request: 400,
  internal: 500,
};

/** JSON error body, sent before the stream starts. `retryAfter` (seconds) accompanies `ai_busy` / `ip_rate_limited`. */
export interface AiErrorBody {
  error: { code: AiErrorCode; retryAfter?: number };
}

export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
}

/** SSE frame. A stream ends with exactly one `done` or `error`. */
export type AiFrame =
  | { type: 'queued'; position: number }
  | { type: 'delta'; text: string }
  | { type: 'done'; usage: AiUsage }
  | { type: 'error'; code: AiErrorCode; retryAfter?: number };

export const AI_LIMITS = {
  /** Maximum request body size, in bytes. */
  maxBodyBytes: 200_000,
  maxFiles: 400,
  maxSkipped: 2000,
  maxPathLength: 1024,
  maxPatchLength: 60_000,
  maxSubjects: 10,
  maxSubjectLength: 200,
  maxCommits: 100,
  maxMessageLength: 10_000,
  maxBranchLength: 255,
  /** Fallback budget when `/v1/ai/quota` cannot be read. */
  defaultMaxInputTokens: 6000,
} as const;

export const AI_FILE_STATUSES = ['added', 'modified', 'deleted', 'renamed', 'copied', 'typechange'] as const;
export type AiFileStatus = (typeof AI_FILE_STATUSES)[number];

export const AI_SKIP_REASONS = [
  'lockfile',
  'generated',
  'binary',
  'sensitive',
  'secret',
  'undecodable',
  'budget',
] as const;
export type AiSkipReason = (typeof AI_SKIP_REASONS)[number];

/** A file sent to the model: `patch` holds unified hunks (without the `diff --git` header and with secret-looking spans removed). */
export interface AiDiffFile {
  path: string;
  oldPath?: string;
  status: AiFileStatus;
  additions: number;
  deletions: number;
  /** Shortened to fit the budget (only part of the hunks is sent). */
  truncated: boolean;
  patch: string;
}

/** File whose content is withheld: name, reason and line counts only, so the model still knows the file changed. */
export interface AiSkippedFile {
  path: string;
  reason: AiSkipReason;
  additions: number;
  deletions: number;
}

export interface AiDiffContext {
  files: AiDiffFile[];
  skipped: AiSkippedFile[];
}

export const AI_LANGUAGES = ['auto', 'vi', 'en'] as const;
export type AiLanguage = (typeof AI_LANGUAGES)[number];
export const AI_LENGTHS = ['short', 'normal', 'detailed'] as const;
export type AiLength = (typeof AI_LENGTHS)[number];

export interface AiCommitOptions {
  language: AiLanguage;
  conventional: boolean;
  length: AiLength;
}

export interface CommitMessageRequest extends AiDiffContext {
  branch: string | null;
  /** Subjects of up to 10 recent commits, so the model can pick up the repo's writing style. */
  recentSubjects: string[];
  options: AiCommitOptions;
}

export interface ExplainCommitRequest extends AiDiffContext {
  /** Original commit message (subject + body). */
  message: string;
  language: AiLanguage;
}

export interface PrDescriptionRequest extends AiDiffContext {
  base: string;
  head: string;
  /** Subjects of the branch's commits, newest first. */
  commits: string[];
  language: AiLanguage;
}

export interface AiRequestByFeature {
  commit: CommitMessageRequest;
  explain: ExplainCommitRequest;
  pr: PrDescriptionRequest;
}

export interface InstallRequest {
  aiInstallId: string;
}

export interface InstallResponse {
  token: string;
}

export interface QuotaResponse {
  features: Record<AiFeature, { used: number; limit: number }>;
  /** When the next request becomes available (ISO 8601) — 00:00 Vietnam time. */
  resetAt: string;
  maxInputTokens: number;
}

/** `aiInstallId` / `telemetryId`: random UUID v4 generated by the app (`aiInstallId` only after the user opts into AI). */
export const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const SEMVER_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,40})?$/;

// Validation — the server checks request bodies, the app checks responses.

type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000_000;
}

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function stringList(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  return value.every((item) => isString(item, maxLength)) ? (value as string[]) : null;
}

function parseDiffContext(body: Record<string, unknown>): Result<AiDiffContext> {
  const { files, skipped } = body;
  if (!Array.isArray(files) || files.length > AI_LIMITS.maxFiles) return fail('files');
  if (!Array.isArray(skipped) || skipped.length > AI_LIMITS.maxSkipped) return fail('skipped');
  const outFiles: AiDiffFile[] = [];
  for (const file of files) {
    if (!isRecord(file)) return fail('file');
    const { path, oldPath, status, additions, deletions, truncated, patch } = file;
    if (!isString(path, AI_LIMITS.maxPathLength) || path === '') return fail('file.path');
    if (oldPath !== undefined && !isString(oldPath, AI_LIMITS.maxPathLength)) return fail('file.oldPath');
    if (!oneOf(AI_FILE_STATUSES, status)) return fail('file.status');
    if (!isCount(additions) || !isCount(deletions)) return fail('file.count');
    if (typeof truncated !== 'boolean') return fail('file.truncated');
    if (!isString(patch, AI_LIMITS.maxPatchLength)) return fail('file.patch');
    outFiles.push({
      path,
      ...(oldPath !== undefined ? { oldPath } : {}),
      status,
      additions,
      deletions,
      truncated,
      patch,
    });
  }
  const outSkipped: AiSkippedFile[] = [];
  for (const item of skipped) {
    if (!isRecord(item)) return fail('skipped');
    const { path, reason, additions, deletions } = item;
    if (!isString(path, AI_LIMITS.maxPathLength) || path === '') return fail('skipped.path');
    if (!oneOf(AI_SKIP_REASONS, reason)) return fail('skipped.reason');
    if (!isCount(additions) || !isCount(deletions)) return fail('skipped.count');
    outSkipped.push({ path, reason, additions, deletions });
  }
  if (outFiles.length === 0 && outSkipped.length === 0) return fail('empty');
  return { ok: true, value: { files: outFiles, skipped: outSkipped } };
}

export function parseCommitMessageRequest(body: unknown): Result<CommitMessageRequest> {
  if (!isRecord(body)) return fail('body');
  const context = parseDiffContext(body);
  if (!context.ok) return context;
  const { branch, recentSubjects, options } = body;
  if (branch !== null && !isString(branch, AI_LIMITS.maxBranchLength)) return fail('branch');
  const subjects = stringList(recentSubjects, AI_LIMITS.maxSubjects, AI_LIMITS.maxSubjectLength);
  if (subjects === null) return fail('recentSubjects');
  if (!isRecord(options)) return fail('options');
  const { language, conventional, length } = options;
  if (!oneOf(AI_LANGUAGES, language) || typeof conventional !== 'boolean' || !oneOf(AI_LENGTHS, length)) {
    return fail('options');
  }
  return {
    ok: true,
    value: {
      ...context.value,
      branch,
      recentSubjects: subjects,
      options: { language, conventional, length },
    },
  };
}

export function parseExplainCommitRequest(body: unknown): Result<ExplainCommitRequest> {
  if (!isRecord(body)) return fail('body');
  const context = parseDiffContext(body);
  if (!context.ok) return context;
  const { message, language } = body;
  if (!isString(message, AI_LIMITS.maxMessageLength)) return fail('message');
  if (!oneOf(AI_LANGUAGES, language)) return fail('language');
  return { ok: true, value: { ...context.value, message, language } };
}

export function parsePrDescriptionRequest(body: unknown): Result<PrDescriptionRequest> {
  if (!isRecord(body)) return fail('body');
  const context = parseDiffContext(body);
  if (!context.ok) return context;
  const { base, head, commits, language } = body;
  if (!isString(base, AI_LIMITS.maxBranchLength) || !isString(head, AI_LIMITS.maxBranchLength)) {
    return fail('branch');
  }
  const subjects = stringList(commits, AI_LIMITS.maxCommits, AI_LIMITS.maxSubjectLength);
  if (subjects === null) return fail('commits');
  if (!oneOf(AI_LANGUAGES, language)) return fail('language');
  return { ok: true, value: { ...context.value, base, head, commits: subjects, language } };
}

export const AI_REQUEST_PARSERS: { [F in AiFeature]: (body: unknown) => Result<AiRequestByFeature[F]> } = {
  commit: parseCommitMessageRequest,
  explain: parseExplainCommitRequest,
  pr: parsePrDescriptionRequest,
};

/** Parse one already-split SSE frame (`event` + `data`). Unknown or malformed frames return `null` (ignored). */
export function parseAiFrame(event: string, data: string): AiFrame | null {
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(payload)) return null;
  switch (event) {
    case 'queued':
      return isCount(payload.position) ? { type: 'queued', position: payload.position } : null;
    case 'delta':
      return typeof payload.text === 'string' ? { type: 'delta', text: payload.text } : null;
    case 'done': {
      const usage = isRecord(payload.usage) ? payload.usage : {};
      return {
        type: 'done',
        usage: {
          promptTokens: isCount(usage.promptTokens) ? usage.promptTokens : 0,
          completionTokens: isCount(usage.completionTokens) ? usage.completionTokens : 0,
        },
      };
    }
    case 'error': {
      const code = oneOf(AI_ERROR_CODES, payload.code) ? payload.code : 'internal';
      return isCount(payload.retryAfter)
        ? { type: 'error', code, retryAfter: payload.retryAfter }
        : { type: 'error', code };
    }
    default:
      return null;
  }
}

/** Parse a JSON error body; `null` when unreadable. */
export function parseAiErrorBody(body: unknown): AiErrorBody['error'] | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  const { code, retryAfter } = body.error;
  if (!oneOf(AI_ERROR_CODES, code)) return null;
  return isCount(retryAfter) ? { code, retryAfter } : { code };
}

export function parseQuotaResponse(body: unknown): QuotaResponse | null {
  if (!isRecord(body) || !isRecord(body.features)) return null;
  const features = {} as QuotaResponse['features'];
  for (const feature of AI_FEATURES) {
    const entry = body.features[feature];
    if (!isRecord(entry) || !isCount(entry.used) || !isCount(entry.limit)) return null;
    features[feature] = { used: entry.used, limit: entry.limit };
  }
  if (typeof body.resetAt !== 'string' || !isCount(body.maxInputTokens)) return null;
  return { features, resetAt: body.resetAt, maxInputTokens: body.maxInputTokens };
}
