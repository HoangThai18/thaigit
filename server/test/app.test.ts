import { writeFileSync, rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AI_HEADERS } from '@thaigit/contracts';
import {
  COMMIT_BODY,
  fakeHermes,
  openAiChunk,
  openAiUsage,
  readSse,
  register,
  setup,
  testConfig,
} from './helpers.ts';

const post = (headers: Record<string, string>, body: unknown = COMMIT_BODY) => ({
  method: 'POST',
  headers,
  body: JSON.stringify(body),
});

describe('AI commit-message', () => {
  it('stream chữ từ Hermes (bỏ <think>), trả done kèm usage, tính một lượt', async () => {
    const hermes = fakeHermes(() => ({
      chunks: [
        openAiChunk('<thi'),
        openAiChunk('nk>đang nghĩ</th'),
        openAiChunk('ink>\nĐổi tiêu đề '),
        openAiChunk('trang chủ'),
        openAiUsage(120, 6),
      ],
    }));
    const { app } = setup({ hermes });
    const { headers } = await register(app);
    const response = await app.request('/v1/ai/commit-message', post(headers));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    const frames = await readSse(response);
    expect(frames).toEqual([
      { event: 'delta', data: { text: 'Đổi tiêu đề ' } },
      { event: 'delta', data: { text: 'trang chủ' } },
      { event: 'done', data: { usage: { promptTokens: 120, completionTokens: 6 } } },
    ]);
    const quota = await (await app.request('/v1/ai/quota', { headers })).json();
    expect(quota.features.commit).toEqual({ used: 1, limit: 30 });
    expect(quota.maxInputTokens).toBe(6000);

    const sent = hermes.requests[0] as { model: string; stream: boolean; messages: { content: string }[] };
    expect(sent.model).toBe('hermes3');
    expect(sent.stream).toBe(true);
    expect(sent.messages[1]?.content).toContain('NỘI-DUNG-BÍ-MẬT-KHÔNG-ĐƯỢC-LƯU');
    expect(sent.messages[1]?.content).toContain('pnpm-lock.yaml [lockfile');
    expect(sent.messages[0]?.content).toContain('untrusted data');
  });

  it('không lưu nội dung diff / ID / IP vào DB', async () => {
    const { app, db } = setup();
    const { id, headers } = await register(app);
    await readSse(await app.request('/v1/ai/commit-message', post(headers)));
    const tables = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
    ).map((row) => row.name);
    const dump = JSON.stringify(tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all()));
    expect(dump).not.toContain('NỘI-DUNG-BÍ-MẬT');
    expect(dump).not.toContain('Sửa lỗi đăng nhập');
    expect(dump).not.toContain(id);
    expect(dump).not.toContain('203.0.113.9');
    const logged = db.prepare('SELECT * FROM ai_requests').all();
    expect(logged).toEqual([
      expect.objectContaining({
        feature: 'commit',
        status: 'ok',
        app_version: '2.0.0-beta.2',
        prompt_tokens: 50,
      }),
    ]);
  });

  it('token sai → 401; body sai → 400; quá lớn → 413', async () => {
    const { app } = setup();
    const { headers } = await register(app);
    const bad = { ...headers, [AI_HEADERS.token]: 'x' };
    expect((await app.request('/v1/ai/commit-message', post(bad))).status).toBe(401);
    expect((await app.request('/v1/ai/quota', { headers: bad })).status).toBe(401);
    const invalid = await app.request('/v1/ai/commit-message', post(headers, { ...COMMIT_BODY, files: 'x' }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: { code: 'bad_request' } });
    const huge = {
      ...COMMIT_BODY,
      recentSubjects: ['x'],
      files: [{ ...COMMIT_BODY.files[0], patch: 'x'.repeat(250_000) }],
    };
    const tooLarge = await app.request('/v1/ai/commit-message', post(headers, huge));
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({ error: { code: 'too_large' } });
  });

  it('hết lượt → 429 quota_exhausted', async () => {
    const { app } = setup({ config: testConfig({ AI_QUOTA_COMMIT: '2', AI_IP_RPM: '100' }) });
    const { headers } = await register(app);
    for (let index = 0; index < 2; index += 1) {
      await readSse(await app.request('/v1/ai/commit-message', post(headers)));
    }
    const response = await app.request('/v1/ai/commit-message', post(headers));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: { code: 'quota_exhausted' } });
  });

  it('kill switch → 503 ai_disabled ngay; model ngừng → ai_unavailable mà /download vẫn chạy', async () => {
    const config = testConfig();
    const { app, state } = setup({ config });
    const { headers } = await register(app);
    writeFileSync(config.ai.killSwitchFile, '');
    try {
      const response = await app.request('/v1/ai/commit-message', post(headers));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: { code: 'ai_disabled' } });
    } finally {
      rmSync(config.ai.killSwitchFile);
    }
    state.aiHealthy = false;
    const down = await app.request('/v1/ai/commit-message', post(headers));
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ error: { code: 'ai_unavailable' } });
    const download = await app.request('/download/win');
    expect(download.status).toBe(302);
    expect((await app.request('/healthz')).status).toBe(200);
  });

  it('Hermes lỗi → frame error ai_unavailable và trả lại lượt', async () => {
    const { app } = setup({ hermes: fakeHermes(() => ({ status: 500 })) });
    const { headers } = await register(app);
    const frames = await readSse(await app.request('/v1/ai/commit-message', post(headers)));
    expect(frames).toEqual([{ event: 'error', data: { code: 'ai_unavailable' } }]);
    const quota = await (await app.request('/v1/ai/quota', { headers })).json();
    expect(quota.features.commit.used).toBe(0);
  });

  it('một cài đặt chỉ một stream cùng lúc; hàng đợi gửi frame queued', async () => {
    const hermes = fakeHermes(() => ({ chunks: [openAiChunk('a'), openAiChunk('b')], delayMs: 40 }));
    const { app } = setup({ hermes, config: testConfig({ AI_MAX_CONCURRENCY: '1' }) });
    const first = await register(app);
    const second = await register(app);
    const running = Promise.resolve(app.request('/v1/ai/commit-message', post(first.headers))).then(readSse);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const again = await app.request('/v1/ai/commit-message', post(first.headers));
    expect(again.status).toBe(503);
    expect(again.headers.get('retry-after')).toBe('5');
    const queued = await readSse(await app.request('/v1/ai/commit-message', post(second.headers)));
    expect(queued[0]).toEqual({ event: 'queued', data: { position: 1 } });
    expect(queued.at(-1)?.event).toBe('done');
    expect((await running).at(-1)?.event).toBe('done');
  });

  it('app ngắt kết nối giữa chừng → huỷ Hermes, nhả slot, trả lượt khi chưa có chữ', async () => {
    const hermes = fakeHermes(() => ({ chunks: [], hang: true }));
    const { app, state } = setup({ hermes });
    const { headers } = await register(app);
    const response = await app.request('/v1/ai/commit-message', post(headers));
    expect(state.activeStreams).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await response.body?.cancel();
    for (let index = 0; index < 50 && state.activeStreams > 0; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(state.activeStreams).toBe(0);
    expect(state.admission.running).toBe(0);
    const quota = await (await app.request('/v1/ai/quota', { headers })).json();
    expect(quota.features.commit.used).toBe(0);
  });

  it('ngữ cảnh quá ngân sách: máy chủ bỏ nội dung file lớn, chỉ giữ tên', async () => {
    const hermes = fakeHermes(() => ({ chunks: [openAiChunk('ok')] }));
    const { app } = setup({ hermes, config: testConfig({ AI_MAX_INPUT_TOKENS: '600' }) });
    const { headers } = await register(app);
    const body = {
      ...COMMIT_BODY,
      files: [
        COMMIT_BODY.files[0],
        { ...COMMIT_BODY.files[0], path: 'big.ts', patch: `@@ -1 +1 @@\n+${'x'.repeat(8000)}\n` },
      ],
    };
    const frames = await readSse(await app.request('/v1/ai/commit-message', post(headers, body)));
    expect(frames.at(-1)?.event).toBe('done');
    const prompt = (hermes.requests[0] as { messages: { content: string }[] }).messages[1]?.content ?? '';
    expect(prompt).toContain('big.ts [content omitted (too large)');
    expect(prompt).toContain('NỘI-DUNG-BÍ-MẬT');
  });
});

describe('IP sau proxy và giới hạn tốc độ', () => {
  it('chỉ tin X-Real-IP khi peer là proxy tin cậy', async () => {
    const { app } = setup({ config: testConfig({ AI_IP_RPM: '1', AI_QUOTA_COMMIT: '100' }) });
    const a = await register(app, undefined, '127.0.0.1');
    const b = await register(app, undefined, '127.0.0.1');
    // Peer không tin cậy gửi X-Real-IP giả: vẫn bị tính theo peer thật → lần 2 bị chặn.
    const spoof = (ip: string) => ({ 'x-test-peer': '198.51.100.7', 'X-Real-IP': ip });
    await readSse(await app.request('/v1/ai/commit-message', post({ ...a.headers, ...spoof('1.1.1.1') })));
    const blocked = await app.request('/v1/ai/commit-message', post({ ...b.headers, ...spoof('2.2.2.2') }));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ error: { code: 'ip_rate_limited' } });
    // Qua proxy tin cậy (127.0.0.1): mỗi IP thật có hạn mức riêng.
    const viaProxy = (ip: string) => ({ 'x-test-peer': '127.0.0.1', 'X-Real-IP': ip });
    const one = await app.request('/v1/ai/commit-message', post({ ...a.headers, ...viaProxy('1.1.1.1') }));
    expect(one.status).toBe(200);
    await one.text();
    const two = await app.request('/v1/ai/commit-message', post({ ...b.headers, ...viaProxy('2.2.2.2') }));
    expect(two.status).toBe(200);
    await two.text();
  });

  it('đăng ký cài đặt tối đa 5 lần/giờ/IP; CORS chỉ cho origin của app', async () => {
    const { app } = setup();
    for (let index = 0; index < 5; index += 1) await register(app);
    const sixth = await app.request('/v1/ai/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-peer': '203.0.113.9' },
      body: JSON.stringify({ aiInstallId: crypto.randomUUID() }),
    });
    expect(sixth.status).toBe(429);
    const preflight = (origin: string) =>
      app.request('/v1/ai/commit-message', {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type,x-ai-install-id,x-ai-token,x-app-version',
        },
      });
    expect((await preflight('tauri://localhost')).headers.get('access-control-allow-origin')).toBe(
      'tauri://localhost',
    );
    expect((await preflight('https://evil.example')).headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('thống kê và lượt tải', () => {
  const ping = {
    telemetryId: '0f8fad5b-d9cb-469f-a165-70867728950e',
    platform: 'windows',
    arch: 'x86_64',
    appVersion: '2.0.0-beta.1',
  };

  it('ping: một dòng mỗi máy mỗi ngày, chỉ băm ID', async () => {
    const { app, db } = setup();
    const send = (body: unknown) =>
      app.request('/v1/telemetry/ping', { method: 'POST', body: JSON.stringify(body) });
    expect((await send(ping)).status).toBe(204);
    expect((await send(ping)).status).toBe(204);
    expect((await send({ ...ping, platform: 'linux' })).status).toBe(400);
    const rows = db.prepare('SELECT * FROM daily_active').all() as { tel_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tel_hash).not.toContain(ping.telemetryId);
  });

  it('download: ghi lượt (không IP) rồi chuyển tới GitHub', async () => {
    const { app, db } = setup();
    const mac = await app.request('/download/mac', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' },
    });
    expect(mac.status).toBe(302);
    expect(mac.headers.get('location')).toBe(
      'https://github.com/HoangThai18/thaigit/releases/latest/download/Thaigit-macOS.zip',
    );
    expect((await app.request('/download/linux')).status).toBe(404);
    expect(db.prepare('SELECT asset, ua_family FROM downloads').all()).toEqual([
      { asset: 'mac', ua_family: 'macos' },
    ]);
  });

  it('stats/downloads: tổng lượt tải theo nền tảng, bỏ lượt của bot', async () => {
    const { app } = setup();
    const browser = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } };
    await app.request('/download/win', browser);
    await app.request('/download/win', browser);
    await app.request('/download/mac', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' },
    });
    await app.request('/download/mac', { headers: { 'User-Agent': 'curl/8.7.1' } });
    const response = await app.request('/v1/stats/downloads');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    expect(await response.json()).toEqual({ total: 3, mac: 1, win: 2 });
  });
});
