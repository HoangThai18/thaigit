import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AI_HEADERS } from '@thaigit/contracts';
import { createApp, type AppDeps } from '../src/app.ts';
import { openDatabase } from '../src/db.ts';
import { loadConfig, type Config } from '../src/env.ts';

export const SECRETS = {
  AI_ID_SECRET: 'a'.repeat(40),
  AI_TOKEN_SECRET: 'b'.repeat(40),
  TELEMETRY_ID_SECRET: 'c'.repeat(40),
};

export function testConfig(extra: Record<string, string> = {}): Config {
  return loadConfig({
    ...SECRETS,
    DATA_DIR: join(tmpdir(), 'thaigit-test-không-dùng'),
    AI_KILL_SWITCH_FILE: join(tmpdir(), `thaigit-test-kill-${randomUUID()}`),
    HERMES_BASE_URL: 'http://hermes.test/v1',
    HERMES_MODEL: 'hermes3',
    ...extra,
  });
}

/** Chunk SSE kiểu OpenAI. */
export function openAiChunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

export function openAiUsage(prompt: number, completion: number): string {
  return `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: prompt, completion_tokens: completion } })}\n\n`;
}

export interface FakeHermes {
  fetch: typeof fetch;
  /** Body JSON các request đã nhận. */
  requests: unknown[];
}

/** Hermes giả: `script` trả các đoạn SSE (có thể chậm), hoặc ném lỗi / trả HTTP lỗi. */
export function fakeHermes(
  script: (body: unknown) => { status?: number; chunks?: string[]; delayMs?: number; hang?: boolean },
): FakeHermes {
  const requests: unknown[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'hermes3' }] });
    const body = JSON.parse(String(init?.body ?? '{}'));
    requests.push(body);
    const plan = script(body);
    if (plan.status !== undefined && plan.status !== 200) return new Response('lỗi', { status: plan.status });
    const encoder = new TextEncoder();
    const signal = init?.signal;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const abort = () => controller.error(new DOMException('aborted', 'AbortError'));
        signal?.addEventListener('abort', abort);
        for (const chunk of plan.chunks ?? []) {
          if (plan.delayMs) await new Promise((resolve) => setTimeout(resolve, plan.delayMs));
          if (signal?.aborted) return;
          controller.enqueue(encoder.encode(chunk));
        }
        if (plan.hang) return;
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch;
  return { fetch: fetchImpl, requests };
}

export function setup(options: { config?: Config; hermes?: FakeHermes; now?: () => number } = {}) {
  const config = options.config ?? testConfig();
  const db = openDatabase(':memory:');
  const hermes =
    options.hermes ?? fakeHermes(() => ({ chunks: [openAiChunk('Thêm tính năng'), openAiUsage(50, 4)] }));
  const deps: AppDeps = {
    config,
    db,
    fetch: hermes.fetch,
    peer: (c) => c.req.header('x-test-peer') ?? '203.0.113.9',
    ...(options.now ? { now: options.now } : {}),
  };
  const { app, state } = createApp(deps);
  return { app, state, db, config, hermes };
}

export async function register(
  app: ReturnType<typeof setup>['app'],
  id = randomUUID(),
  peer = '203.0.113.9',
) {
  const response = await app.request('/v1/ai/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-peer': peer },
    body: JSON.stringify({ aiInstallId: id }),
  });
  const { token } = (await response.json()) as { token: string };
  return {
    id,
    headers: {
      'Content-Type': 'application/json',
      [AI_HEADERS.installId]: id,
      [AI_HEADERS.token]: token,
      [AI_HEADERS.appVersion]: '2.0.0-beta.2',
    } as Record<string, string>,
  };
}

export const COMMIT_BODY = {
  files: [
    {
      path: 'src/app.ts',
      status: 'modified',
      additions: 1,
      deletions: 1,
      truncated: false,
      patch: '@@ -1 +1 @@\n-const title = "cũ";\n+const title = "NỘI-DUNG-BÍ-MẬT-KHÔNG-ĐƯỢC-LƯU";\n',
    },
  ],
  skipped: [{ path: 'pnpm-lock.yaml', reason: 'lockfile', additions: 3, deletions: 1 }],
  branch: 'main',
  recentSubjects: ['Sửa lỗi đăng nhập'],
  options: { language: 'auto', conventional: false, length: 'normal' },
};

/** Đọc toàn bộ SSE thành danh sách {event, data}. */
export async function readSse(response: Response): Promise<{ event: string; data: unknown }[]> {
  const text = await response.text();
  return text
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? 'message';
      const data = /^data: (.*)$/m.exec(block)?.[1] ?? 'null';
      return { event, data: JSON.parse(data) as unknown };
    });
}
