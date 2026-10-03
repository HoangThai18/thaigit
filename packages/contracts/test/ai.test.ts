import { describe, expect, it } from 'vitest';
import {
  AI_LIMITS,
  parseAiErrorBody,
  parseAiFrame,
  parseCommitMessageRequest,
  parsePrDescriptionRequest,
  parseQuotaResponse,
  parseTelemetryPing,
} from '../src/index.ts';

const file = {
  path: 'src/app.ts',
  status: 'modified',
  additions: 2,
  deletions: 1,
  truncated: false,
  patch: '@@ -1 +1,2 @@\n-a\n+b\n+c\n',
};

const commitBody = {
  files: [file],
  skipped: [{ path: 'pnpm-lock.yaml', reason: 'lockfile', additions: 40, deletions: 3 }],
  branch: 'main',
  recentSubjects: ['Sửa lỗi đăng nhập'],
  options: { language: 'auto', conventional: false, length: 'normal' },
};

describe('parseCommitMessageRequest', () => {
  it('nhận body hợp lệ và chỉ giữ các trường đã biết', () => {
    const result = parseCommitMessageRequest({ ...commitBody, extra: 'x', files: [{ ...file, junk: 1 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files[0]).toEqual(file);
    expect('extra' in result.value).toBe(false);
  });

  it('từ chối body sai kiểu, quá lớn hoặc rỗng', () => {
    expect(parseCommitMessageRequest(null).ok).toBe(false);
    expect(parseCommitMessageRequest({ ...commitBody, files: 'x' }).ok).toBe(false);
    expect(parseCommitMessageRequest({ ...commitBody, files: [], skipped: [] }).ok).toBe(false);
    expect(parseCommitMessageRequest({ ...commitBody, files: [{ ...file, status: 'exploded' }] }).ok).toBe(
      false,
    );
    expect(
      parseCommitMessageRequest({
        ...commitBody,
        recentSubjects: Array.from({ length: AI_LIMITS.maxSubjects + 1 }, () => 's'),
      }).ok,
    ).toBe(false);
    expect(
      parseCommitMessageRequest({ ...commitBody, options: { ...commitBody.options, language: 'fr' } }).ok,
    ).toBe(false);
    expect(
      parseCommitMessageRequest({
        ...commitBody,
        files: [{ ...file, patch: 'x'.repeat(AI_LIMITS.maxPatchLength + 1) }],
      }).ok,
    ).toBe(false);
  });

  it('PR: cần base/head và danh sách commit', () => {
    const body = {
      files: [file],
      skipped: [],
      base: 'main',
      head: 'feature/x',
      commits: ['a'],
      language: 'vi',
    };
    expect(parsePrDescriptionRequest(body).ok).toBe(true);
    expect(parsePrDescriptionRequest({ ...body, commits: [1] }).ok).toBe(false);
  });
});

describe('frame SSE và body lỗi', () => {
  it('đọc từng loại frame', () => {
    expect(parseAiFrame('queued', '{"position":3}')).toEqual({ type: 'queued', position: 3 });
    expect(parseAiFrame('delta', '{"text":"Sửa"}')).toEqual({ type: 'delta', text: 'Sửa' });
    expect(parseAiFrame('done', '{"usage":{"promptTokens":10,"completionTokens":5}}')).toEqual({
      type: 'done',
      usage: { promptTokens: 10, completionTokens: 5 },
    });
    expect(parseAiFrame('error', '{"code":"ai_busy","retryAfter":20}')).toEqual({
      type: 'error',
      code: 'ai_busy',
      retryAfter: 20,
    });
  });

  it('mã lỗi lạ thành internal; frame hỏng bị bỏ qua', () => {
    expect(parseAiFrame('error', '{"code":"boom"}')).toEqual({ type: 'error', code: 'internal' });
    expect(parseAiFrame('delta', '{"text":1}')).toBeNull();
    expect(parseAiFrame('delta', 'không phải json')).toBeNull();
    expect(parseAiFrame('ping', '{}')).toBeNull();
  });

  it('body lỗi và quota', () => {
    expect(parseAiErrorBody({ error: { code: 'quota_exhausted' } })).toEqual({ code: 'quota_exhausted' });
    expect(parseAiErrorBody({ error: { code: 'x' } })).toBeNull();
    const quota = {
      features: {
        commit: { used: 1, limit: 30 },
        explain: { used: 0, limit: 20 },
        pr: { used: 0, limit: 10 },
      },
      resetAt: '2026-10-03T17:00:00.000Z',
      maxInputTokens: 6000,
    };
    expect(parseQuotaResponse(quota)).toEqual(quota);
    expect(parseQuotaResponse({ ...quota, features: { commit: quota.features.commit } })).toBeNull();
  });
});

describe('parseTelemetryPing', () => {
  const ping = {
    telemetryId: '0f8fad5b-d9cb-469f-a165-70867728950e',
    platform: 'windows',
    arch: 'x86_64',
    appVersion: '2.0.0-beta.1',
  };

  it('chỉ nhận đúng 4 trường hợp lệ', () => {
    expect(parseTelemetryPing({ ...ping, hostname: 'may-cua-toi' })).toEqual(ping);
    expect(parseTelemetryPing({ ...ping, telemetryId: 'abc' })).toBeNull();
    expect(parseTelemetryPing({ ...ping, platform: 'linux' })).toBeNull();
    expect(parseTelemetryPing({ ...ping, appVersion: '2.0' })).toBeNull();
  });
});
