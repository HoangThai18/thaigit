// API công khai (sau nginx/Caddy): /v1/ai/* (proxy tới Hermes), /v1/telemetry/ping, /download/:asset, /healthz.
// Không bao giờ ghi nội dung diff / message / IP / ID gốc vào DB hay log — chỉ số liệu kỹ thuật.

import { existsSync } from 'node:fs';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import {
  AI_ERROR_STATUS,
  AI_FEATURES,
  AI_HEADERS,
  AI_LIMITS,
  AI_REQUEST_PARSERS,
  AI_ROUTES,
  DOWNLOAD_ASSETS,
  SEMVER_PATTERN,
  UUID_V4_PATTERN,
  parseTelemetryPing,
  type AiErrorCode,
  type AiFeature,
  type AiRequestByFeature,
  type AiUsage,
  type DownloadAsset,
  type QuotaResponse,
} from '@thaigit/contracts';
import { fitContext, messagesTokens } from './ai/budget.ts';
import { buildMessages } from './ai/prompts.ts';
import { ThinkFilter } from './ai/think-filter.ts';
import { streamChat, UpstreamError } from './ai/upstream.ts';
import { clientIp, rateKey } from './client-ip.ts';
import { constantTimeEqual, hmacHex, installToken } from './crypto.ts';
import { pingDatabase, type Db } from './db.ts';
import type { Config } from './env.ts';
import { Admission, AdmissionRejected } from './limits/admission.ts';
import { consumeQuota, installInfo, recordSuccess, refundQuota, usedToday } from './limits/quota.ts';
import { DailyCounter, RateLimiter } from './limits/rate.ts';
import { nextVnMidnight, vnDay } from './time.ts';

export interface AppDeps {
  config: Config;
  db: Db;
  now?: () => number;
  fetch?: typeof fetch;
  /** Địa chỉ socket của peer (test thay bằng giá trị giả). */
  peer?: (c: Context) => string;
}

export interface AppState {
  /** Kết quả kiểm model gần nhất (cập nhật bởi vòng health ở main.ts). */
  aiHealthy: boolean;
  /** Số stream SSE đang mở (để xả khi tắt máy chủ). */
  activeStreams: number;
  admission: Admission;
}

type Env = { Variables: { ip: string; idHash: string; appVersion: string | null } };

const DOWNLOAD_TARGETS: Record<DownloadAsset, (repo: string) => { url: string; manifest: string }> = {
  mac: (repo) => ({
    url: `https://github.com/${repo}/releases/latest/download/Thaigit-macOS.zip`,
    manifest: `https://github.com/${repo}/releases/latest/download/update.json`,
  }),
  win: (repo) => ({
    url: `https://github.com/${repo}/releases/download/desktop-beta/Thaigit-Windows-setup.exe`,
    manifest: `https://github.com/${repo}/releases/download/desktop-beta/latest.json`,
  }),
};

function uaFamily(ua: string | undefined): string {
  const value = (ua ?? '').toLowerCase();
  if (/iphone|ipad|android|mobile/.test(value)) return 'mobile';
  if (value.includes('windows')) return 'windows';
  if (value.includes('mac os') || value.includes('macintosh')) return 'macos';
  if (value.includes('linux')) return 'linux';
  if (/curl|wget|bot|spider|crawl/.test(value)) return 'bot';
  return 'other';
}

export function createApp(deps: AppDeps): { app: Hono<Env>; state: AppState } {
  const { config, db } = deps;
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetch ?? fetch;
  const peerOf = deps.peer ?? (() => '0.0.0.0');
  const state: AppState = {
    aiHealthy: true,
    activeStreams: 0,
    admission: new Admission({
      concurrency: config.ai.maxConcurrency,
      queueMax: config.ai.queueMax,
      timeoutMs: config.ai.queueTimeoutMs,
    }),
  };
  const globalRate = new RateLimiter(config.ai.globalRpm, 60_000);
  const ipRate = new RateLimiter(config.ai.ipRpm, 60_000);
  const installRate = new RateLimiter(5, 60 * 60_000);
  const telemetryNewIds = new DailyCounter();
  const activeInstalls = new Set<string>();
  const versions = new Map<DownloadAsset, { version: string | null; fetchedAt: number }>();

  const app = new Hono<Env>();

  app.use('*', async (c, next) => {
    c.set('ip', clientIp(peerOf(c), c.req.header('X-Real-IP'), config.trustedProxies));
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
  });
  app.use(
    '/v1/*',
    cors({
      origin: (origin) => (config.corsOrigins.includes(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', AI_HEADERS.installId, AI_HEADERS.token, AI_HEADERS.appVersion],
      exposeHeaders: ['Retry-After'],
      maxAge: 86400,
    }),
  );

  const aiError = (c: Context, code: AiErrorCode, retryAfter?: number) => {
    if (retryAfter !== undefined) c.header('Retry-After', String(retryAfter));
    return c.json(
      { error: { code, ...(retryAfter !== undefined ? { retryAfter } : {}) } },
      AI_ERROR_STATUS[code] as 400,
    );
  };
  const aiDisabled = () => existsSync(config.ai.killSwitchFile);

  const auth: MiddlewareHandler<Env> = async (c, next) => {
    const id = c.req.header(AI_HEADERS.installId) ?? '';
    const token = c.req.header(AI_HEADERS.token) ?? '';
    if (!UUID_V4_PATTERN.test(id) || !constantTimeEqual(token, installToken(config.secrets.aiToken, id))) {
      return aiError(c, 'invalid_token');
    }
    const version = c.req.header(AI_HEADERS.appVersion) ?? '';
    c.set('idHash', hmacHex(config.secrets.aiId, id));
    c.set('appVersion', SEMVER_PATTERN.test(version) ? version : null);
    await next();
  };

  // ── Sức khoẻ ──────────────────────────────────────────────────────────────────────────────────────────────────
  app.get('/healthz', (c) => {
    const dbOk = pingDatabase(db);
    const ai = aiDisabled() ? 'disabled' : state.aiHealthy ? 'ok' : 'down';
    return c.json({ api: 'ok', db: dbOk ? 'ok' : 'down', ai }, dbOk ? 200 : 503);
  });

  // ── AI: đăng ký cài đặt (chỉ gọi sau khi người dùng đồng ý dùng AI) ────────────────────────────────────────────
  app.post(
    '/v1/ai/install',
    bodyLimit({ maxSize: 1024, onError: (c) => aiError(c, 'too_large') }),
    async (c) => {
      const limit = installRate.take(rateKey(c.get('ip')), now());
      if (!limit.ok) return aiError(c, 'ip_rate_limited', limit.retryAfter);
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return aiError(c, 'bad_request');
      }
      const id = (body as { aiInstallId?: unknown } | null)?.aiInstallId;
      if (typeof id !== 'string' || !UUID_V4_PATTERN.test(id)) return aiError(c, 'bad_request');
      installInfo(db, hmacHex(config.secrets.aiId, id), vnDay(now()));
      return c.json({ token: installToken(config.secrets.aiToken, id) });
    },
  );

  app.get('/v1/ai/quota', auth, (c) => {
    const used = usedToday(db, vnDay(now()), c.get('idHash'));
    const features = Object.fromEntries(
      AI_FEATURES.map((feature) => [feature, { used: used[feature], limit: config.ai.quota[feature] }]),
    ) as QuotaResponse['features'];
    const body: QuotaResponse = {
      features,
      resetAt: nextVnMidnight(now()),
      maxInputTokens: config.ai.maxInputTokens,
    };
    return c.json(body);
  });

  // ── AI: sinh chữ (SSE) ─────────────────────────────────────────────────────────────────────────────────────────
  const logRequest = (entry: {
    feature: AiFeature;
    appVersion: string | null;
    usage: AiUsage | null;
    queueMs: number | null;
    ttftMs: number | null;
    latencyMs: number;
    status: 'ok' | 'error' | 'cancelled';
    errorCode: AiErrorCode | null;
  }) => {
    try {
      db.prepare(
        `INSERT INTO ai_requests (ts, day, feature, app_version, prompt_tokens, completion_tokens, queue_ms, ttft_ms,
           latency_ms, status, error_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        now(),
        vnDay(now()),
        entry.feature,
        entry.appVersion,
        entry.usage?.promptTokens ?? null,
        entry.usage?.completionTokens ?? null,
        entry.queueMs,
        entry.ttftMs,
        entry.latencyMs,
        entry.status,
        entry.errorCode,
      );
    } catch {
      // Số liệu kỹ thuật: mất một dòng không ảnh hưởng người dùng.
    }
  };

  for (const feature of AI_FEATURES) {
    app.post(
      AI_ROUTES[feature],
      async (c, next) => (aiDisabled() ? aiError(c, 'ai_disabled') : next()),
      auth,
      bodyLimit({ maxSize: AI_LIMITS.maxBodyBytes, onError: (c) => aiError(c, 'too_large') }),
      async (c) => {
        const startedAt = now();
        let raw: unknown;
        try {
          raw = await c.req.json();
        } catch {
          return aiError(c, 'bad_request');
        }
        const parsed = AI_REQUEST_PARSERS[feature](raw);
        if (!parsed.ok) return aiError(c, 'bad_request');
        if (!state.aiHealthy) return aiError(c, 'ai_unavailable');

        const idHash = c.get('idHash');
        const appVersion = c.get('appVersion');
        const day = vnDay(startedAt);
        let info;
        try {
          info = installInfo(db, idHash, day);
        } catch {
          return aiError(c, 'internal');
        }
        if (info.blocked) return aiError(c, 'ai_disabled');

        const ipKey = rateKey(c.get('ip'));
        const perIp = ipRate.take(ipKey, startedAt);
        if (!perIp.ok) return aiError(c, 'ip_rate_limited', perIp.retryAfter);
        const global = globalRate.take('global', startedAt);
        if (!global.ok) {
          ipRate.refund(ipKey);
          return aiError(c, 'ai_busy', global.retryAfter);
        }
        if (activeInstalls.has(idHash)) return aiError(c, 'ai_busy', 5);

        const request = fitContext(
          parsed.value as AiRequestByFeature[typeof feature],
          config.ai.maxInputTokens,
          (r) => messagesTokens(buildMessages(feature, r)),
        );
        if (request === null) return aiError(c, 'too_large');
        const messages = buildMessages(feature, request);

        let granted: boolean;
        try {
          granted = consumeQuota(db, day, idHash, feature, config.ai.quota[feature]);
        } catch {
          return aiError(c, 'internal');
        }
        if (!granted) return aiError(c, 'quota_exhausted');
        const refund = () => {
          try {
            refundQuota(db, day, idHash, feature);
          } catch {
            // Hiếm: lượt này bị tính dù không ra kết quả.
          }
        };
        const ticket = state.admission.enter(info.veteran);
        if (ticket === null) {
          refund();
          return aiError(c, 'ai_busy', 30);
        }

        activeInstalls.add(idHash);
        state.activeStreams += 1;
        c.header('X-Accel-Buffering', 'no');
        return streamSSE(c, async (stream) => {
          const controller = new AbortController();
          stream.onAbort(() => controller.abort());
          const send = async (event: string, data: unknown) => {
            if (controller.signal.aborted) return;
            try {
              await stream.writeSSE({ event, data: JSON.stringify(data) });
            } catch {
              controller.abort();
            }
          };
          let queueMs: number | null = null;
          let ttftMs: number | null = null;
          let usage: AiUsage | null = null;
          let emitted = 0;
          let status: 'ok' | 'error' | 'cancelled' = 'ok';
          let errorCode: AiErrorCode | null = null;
          try {
            try {
              await ticket.wait((position) => void send('queued', { position }));
            } catch (error) {
              if (!(error instanceof AdmissionRejected)) throw error;
              refund();
              status = 'error';
              errorCode = 'ai_busy';
              await send('error', { code: 'ai_busy', retryAfter: 30 });
              return;
            }
            const slotAt = now();
            queueMs = slotAt - startedAt;
            if (controller.signal.aborted) {
              refund();
              status = 'cancelled';
              return;
            }
            const filter = new ThinkFilter();
            try {
              for await (const chunk of streamChat(
                config.hermes,
                messages,
                config.ai.maxTokens[feature],
                controller.signal,
                fetchImpl,
              )) {
                if (chunk.type === 'usage') {
                  usage = chunk.usage;
                  continue;
                }
                const visible = filter.push(chunk.text);
                if (visible === '') continue;
                ttftMs ??= now() - slotAt;
                emitted += visible.length;
                await send('delta', { text: visible });
              }
              const tail = filter.end();
              if (tail !== '') {
                ttftMs ??= now() - slotAt;
                emitted += tail.length;
                await send('delta', { text: tail });
              }
            } catch (error) {
              const kind = error instanceof UpstreamError ? error.kind : 'unavailable';
              if (emitted === 0) refund();
              if (kind === 'cancelled') {
                status = 'cancelled';
                return;
              }
              status = 'error';
              errorCode = 'ai_unavailable';
              await send('error', { code: 'ai_unavailable' });
              return;
            }
            if (controller.signal.aborted) {
              status = 'cancelled';
              if (emitted === 0) refund();
              return;
            }
            if (emitted === 0) {
              refund();
              status = 'error';
              errorCode = 'ai_unavailable';
              await send('error', { code: 'ai_unavailable' });
              return;
            }
            usage ??= { promptTokens: messagesTokens(messages), completionTokens: Math.ceil(emitted / 3.5) };
            await send('done', { usage });
            try {
              recordSuccess(db, idHash, day);
            } catch {
              // Chỉ ảnh hưởng mức ưu tiên lần sau.
            }
          } finally {
            ticket.release();
            activeInstalls.delete(idHash);
            state.activeStreams -= 1;
            logRequest({
              feature,
              appVersion,
              usage,
              queueMs,
              ttftMs,
              latencyMs: now() - startedAt,
              status,
              errorCode,
            });
          }
        });
      },
    );
  }

  // ── Thống kê ẩn danh (chỉ khi người dùng bật) ──────────────────────────────────────────────────────────────────
  app.post(
    '/v1/telemetry/ping',
    bodyLimit({ maxSize: 2048, onError: (c) => c.body(null, 413) }),
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.body(null, 400);
      }
      const ping = parseTelemetryPing(body);
      if (ping === null) return c.body(null, 400);
      const day = vnDay(now());
      const telHash = hmacHex(config.secrets.telemetryId, ping.telemetryId);
      try {
        const known = db
          .prepare('SELECT 1 FROM daily_active WHERE day = ? AND tel_hash = ?')
          .get(day, telHash);
        if (known !== undefined) return c.body(null, 204);
        if (telemetryNewIds.increment(day, rateKey(c.get('ip'))) > config.telemetry.newIdsPerIpPerDay) {
          return c.body(null, 429);
        }
        db.prepare(
          `INSERT OR IGNORE INTO daily_active (day, tel_hash, platform, arch, app_version) VALUES (?, ?, ?, ?, ?)`,
        ).run(day, telHash, ping.platform, ping.arch, ping.appVersion);
      } catch {
        return c.body(null, 503);
      }
      return c.body(null, 204);
    },
  );

  // ── Đếm lượt tải: ghi một dòng (không IP) rồi chuyển tới file trên GitHub Releases ─────────────────────────────
  const refreshVersion = async (asset: DownloadAsset, manifest: string) => {
    const cached = versions.get(asset);
    if (cached !== undefined && now() - cached.fetchedAt < 5 * 60_000) return;
    versions.set(asset, { version: cached?.version ?? null, fetchedAt: now() });
    try {
      const response = await fetchImpl(manifest, { signal: AbortSignal.timeout(5000) });
      const body = (await response.json()) as { version?: unknown };
      const version = typeof body.version === 'string' ? body.version.replace(/^v/, '') : null;
      if (version !== null && SEMVER_PATTERN.test(version))
        versions.set(asset, { version, fetchedAt: now() });
    } catch {
      // Giữ phiên bản cũ; lần sau thử lại.
    }
  };

  app.get('/download/:asset', (c) => {
    const asset = c.req.param('asset');
    if (!(DOWNLOAD_ASSETS as readonly string[]).includes(asset)) return c.notFound();
    const target = DOWNLOAD_TARGETS[asset as DownloadAsset](config.download.repo);
    void refreshVersion(asset as DownloadAsset, target.manifest);
    try {
      db.prepare('INSERT INTO downloads (ts, day, asset, version, ua_family) VALUES (?, ?, ?, ?, ?)').run(
        now(),
        vnDay(now()),
        asset,
        versions.get(asset as DownloadAsset)?.version ?? null,
        uaFamily(c.req.header('User-Agent')),
      );
    } catch {
      // Không đếm được vẫn cho tải.
    }
    c.header('Cache-Control', 'no-store');
    return c.redirect(target.url, 302);
  });

  app.notFound((c) => c.json({ error: { code: 'bad_request' } }, 404));
  app.onError((error, c) => {
    console.error(`[thaigit-api] ${error.name}`);
    return c.json({ error: { code: 'internal' } }, 500);
  });

  return { app, state };
}
