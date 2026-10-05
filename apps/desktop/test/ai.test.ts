// The app side of AI: nothing is sent before consent; registration is lazy; a broken token re-registers;
// an error code becomes a friendly sentence; writing a commit streams into the composer on a real git repo
// (against a fake server).
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { AiClient, AiFailure } from '../src/lib/ai/client.ts';
import { CommitWriter } from '../src/lib/ai/commitWriter.svelte.ts';
import { friendlyError } from '../src/lib/errors/friendly.ts';
import { AI_STORAGE_KEY, AiStore } from '../src/lib/stores/ai.svelte.ts';
import { PrefsStore, type KeyValueStorage } from '../src/lib/stores/prefs.svelte.ts';
import { RepoStore, Scope } from '../src/lib/stores/repo.svelte.ts';
import { ToastStore, toasts } from '../src/lib/stores/toasts.svelte.ts';
import { openTestPort } from './helpers/node-port.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  toasts.clear();
});

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

function sse(frames: [string, unknown][]): Response {
  const text = frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  return new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });
}

interface Call {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeServer(handler: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  }) as typeof fetch;
  return { calls, fetch: fetchImpl };
}

function makeStore(server: ReturnType<typeof fakeServer>, storage = memoryStorage()) {
  let next = 0;
  const ids = ['0f8fad5b-d9cb-469f-a165-70867728950e', '7c9e6679-7425-40de-944b-e07fc1f90ae7'];
  const store = new AiStore({
    client: new AiClient({
      baseUrl: 'https://may-chu.test/',
      appVersion: '2.0.0-beta.2',
      fetch: server.fetch,
    }),
    storage,
    randomId: () => ids[next++ % ids.length] ?? '',
  });
  return { store, storage };
}

const REQUEST = {
  files: [],
  skipped: [{ path: 'a.png', reason: 'binary' as const, additions: 0, deletions: 0 }],
  branch: 'main',
  recentSubjects: [],
  options: { language: 'auto' as const, conventional: false, length: 'normal' as const },
};

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

describe('AiStore', () => {
  it('chưa đồng ý: không request nào, không có mã cài đặt', async () => {
    const server = fakeServer(() => new Response('{}'));
    const { store, storage } = makeStore(server);
    await expect(store.identity()).rejects.toEqual(new AiFailure('cancelled'));
    await store.refreshQuota();
    const answer = store.askConsent({
      feature: 'commit',
      branch: 'main',
      files: [],
      skipped: [],
      redactions: 0,
      subjects: [],
    });
    expect(store.pending?.mode).toBe('consent');
    store.answer(false);
    expect(await answer).toBe(false);
    expect(store.consented).toBe(false);
    expect(server.calls).toEqual([]);
    expect(storage.data.get(AI_STORAGE_KEY) ?? '').not.toContain('installId":"');
  });

  it('đồng ý → đăng ký lười đúng một lần, gửi đủ header; tắt AI xoá mã', async () => {
    const server = fakeServer((call) =>
      call.url.endsWith('/v1/ai/install')
        ? Response.json({ token: 'tok-1' })
        : sse([
            ['delta', { text: 'Thêm ảnh' }],
            ['done', { usage: { promptTokens: 1, completionTokens: 1 } }],
          ]),
    );
    const { store, storage } = makeStore(server);
    const consent = store.askConsent({
      feature: 'commit',
      branch: null,
      files: [],
      skipped: [],
      redactions: 0,
      subjects: [],
    });
    store.answer(true);
    expect(await consent).toBe(true);
    const [a, b] = await Promise.all([store.identity(), store.identity()]);
    expect(a).toEqual(b);
    const frames = await collect(store.run('commit', REQUEST, new AbortController().signal));
    expect(frames.map((frame) => frame.type)).toEqual(['delta', 'done']);
    expect(server.calls.map((call) => call.url)).toEqual([
      'https://may-chu.test/v1/ai/install',
      'https://may-chu.test/v1/ai/commit-message',
    ]);
    expect(server.calls[0]?.body).toEqual({ aiInstallId: '0f8fad5b-d9cb-469f-a165-70867728950e' });
    expect(server.calls[1]?.headers).toMatchObject({
      'x-ai-install-id': '0f8fad5b-d9cb-469f-a165-70867728950e',
      'x-ai-token': 'tok-1',
      'x-app-version': '2.0.0-beta.2',
    });
    expect(JSON.parse(storage.data.get(AI_STORAGE_KEY) ?? '{}')).toMatchObject({
      consented: true,
      token: 'tok-1',
    });

    store.disable();
    expect(store.consented).toBe(false);
    expect(JSON.parse(storage.data.get(AI_STORAGE_KEY) ?? '{}')).toMatchObject({
      installId: null,
      token: null,
    });
  });

  it('token bị từ chối → đăng ký lại một lần rồi gửi lại', async () => {
    let installs = 0;
    const server = fakeServer((call, index) => {
      if (call.url.endsWith('/install')) return Response.json({ token: `tok-${++installs}` });
      if (index === 1) return Response.json({ error: { code: 'invalid_token' } }, { status: 401 });
      return sse([['done', { usage: {} }]]);
    });
    const { store } = makeStore(server);
    store.askConsent({
      feature: 'commit',
      branch: null,
      files: [],
      skipped: [],
      redactions: 0,
      subjects: [],
    });
    store.answer(true);
    const frames = await collect(store.run('commit', REQUEST, new AbortController().signal));
    expect(frames).toEqual([{ type: 'done', usage: { promptTokens: 0, completionTokens: 0 } }]);
    expect(installs).toBe(2);
    expect(server.calls[3]?.headers['x-ai-token']).toBe('tok-2');
  });
});

describe('AiClient: lỗi → mã, mã → câu thân thiện', () => {
  const identity = { installId: '0f8fad5b-d9cb-469f-a165-70867728950e', token: 't' };
  const failure = async (response: Response | Error) => {
    const server = fakeServer(() => {
      if (response instanceof Error) throw response;
      return response;
    });
    const client = new AiClient({ baseUrl: 'https://x.test', appVersion: '', fetch: server.fetch });
    try {
      await collect(client.stream(identity, 'commit', REQUEST, new AbortController().signal));
    } catch (error) {
      return error as AiFailure;
    }
    throw new Error('phải lỗi');
  };

  it('đọc mã lỗi JSON, Retry-After, trang lỗi của proxy, mất mạng', async () => {
    expect((await failure(Response.json({ error: { code: 'quota_exhausted' } }, { status: 429 }))).code).toBe(
      'quota_exhausted',
    );
    const busy = await failure(
      Response.json({ error: { code: 'ai_busy' } }, { status: 503, headers: { 'Retry-After': '12' } }),
    );
    expect([busy.code, busy.retryAfter]).toEqual(['ai_busy', 12]);
    expect((await failure(new Response('<html>Bad gateway</html>', { status: 502 }))).code).toBe(
      'ai_unavailable',
    );
    expect((await failure(new TypeError('Failed to fetch'))).code).toBe('network');
  });

  it('không hiện thông báo gốc, chỉ câu tiếng Việt', () => {
    expect(friendlyError(new AiFailure('ai_busy', 12))).toContain('12 giây');
    expect(friendlyError(new AiFailure('quota_exhausted'))).toContain('0:00');
    expect(friendlyError(new AiFailure('internal'))).not.toContain('internal');
  });
});

describe('CommitWriter (git thật + máy chủ giả)', () => {
  async function setup(handler: Parameters<typeof fakeServer>[0]) {
    const test = await openTestPort((git, root) => {
      writeFileSync(join(root, 'a.txt'), 'một\n');
      git('add', '.');
      git('commit', '-q', '-m', 'Khởi tạo');
    });
    cleanups.push(() => test.cleanup());
    const store = new RepoStore(test.port, {
      prefs: new PrefsStore(null),
      toasts: new ToastStore(),
      detailsDelayMs: 0,
      clipboard: async () => {},
    });
    cleanups.push(() => store.dispose());
    await store.start();
    const server = fakeServer(handler);
    const { store: ai } = makeStore(server);
    ai.saved.consented = true;
    ai.saved.installId = '0f8fad5b-d9cb-469f-a165-70867728950e';
    ai.saved.token = 'tok';
    return { test, store, ai, server };
  }

  it('stream vào ô soạn, không gửi file nhạy cảm; Hoàn tác trả nội dung cũ', async () => {
    const { test, store, ai, server } = await setup((call) =>
      call.url.endsWith('/quota')
        ? Response.json({})
        : sse([
            ['queued', { position: 1 }],
            ['delta', { text: '<think>x</think>Thêm dòng hai' }],
            ['delta', { text: '\n\n- Ghi chú' }],
            ['done', { usage: { promptTokens: 5, completionTokens: 3 } }],
          ]),
    );
    await test.write('a.txt', 'một\nhai\n');
    await test.write('.env', 'API_KEY=bi-mat-khong-gui\n');
    test.git('add', '.');
    await store.refreshAndWait(Scope.all);
    store.commitDraft.summary = 'cũ';
    const writer = new CommitWriter(store, ai);
    await writer.start();
    expect(store.commitDraft.summary).toBe('Thêm dòng hai');
    expect(store.commitDraft.body).toBe('- Ghi chú');
    const body = server.calls.find((call) => call.url.endsWith('/commit-message'))?.body;
    expect(JSON.stringify(body)).not.toContain('bi-mat-khong-gui');
    expect(body).toMatchObject({
      branch: 'main',
      recentSubjects: ['Khởi tạo'],
      skipped: [{ path: '.env', reason: 'sensitive' }],
    });
    writer.undo();
    expect(store.commitDraft.summary).toBe('cũ');
  });

  it('lỗi giữa chừng → trả ô soạn về như cũ và báo lỗi thân thiện', async () => {
    const { test, store, ai } = await setup(() =>
      sse([
        ['delta', { text: 'Viết dở' }],
        ['error', { code: 'ai_unavailable' }],
      ]),
    );
    await test.write('a.txt', 'một\nba\n');
    test.git('add', '.');
    await store.refreshAndWait(Scope.all);
    store.commitDraft.summary = 'giữ nguyên';
    const writer = new CommitWriter(store, ai);
    await writer.start();
    expect(store.commitDraft.summary).toBe('giữ nguyên');
    expect(writer.previous).toBeNull();
    const toast = toasts.items.at(-1);
    expect(toast?.title).toBe('AI chưa viết được');
    expect(toast?.message).toBe('Máy chủ AI đang tạm ngừng — thử lại sau.');
  });
});

describe('markdown của AI (allow-list)', () => {
  it('chỉ còn chữ: link thành chữ, HTML và ảnh bị bỏ', async () => {
    const { parseMarkdown } = await import('../src/lib/ai/markdown.ts');
    const blocks = parseMarkdown(
      '## Tóm tắt\nSửa **lỗi** đăng nhập trong `auth.ts`.\n\n- Xem [tài liệu](https://evil.example)\n- <img src=x onerror=alert(1)>Ảnh ![logo](x.png)\n\n```\nconst a = 1;\n```',
    );
    expect(blocks).toEqual([
      { kind: 'heading', level: 2, inlines: [{ kind: 'text', text: 'Tóm tắt' }] },
      {
        kind: 'paragraph',
        inlines: [
          { kind: 'text', text: 'Sửa ' },
          { kind: 'bold', text: 'lỗi' },
          { kind: 'text', text: ' đăng nhập trong ' },
          { kind: 'code', text: 'auth.ts' },
          { kind: 'text', text: '.' },
        ],
      },
      {
        kind: 'item',
        ordered: false,
        marker: '•',
        depth: 0,
        inlines: [{ kind: 'text', text: 'Xem tài liệu (https://evil.example)' }],
      },
      { kind: 'item', ordered: false, marker: '•', depth: 0, inlines: [{ kind: 'text', text: 'Ảnh logo' }] },
      { kind: 'code', text: 'const a = 1;' },
    ]);
  });
});

describe('AiResultStore (giải thích commit / mô tả PR)', () => {
  it('stream markdown, bỏ <think>; không có gì để gửi thì báo ngay', async () => {
    const { AiResultStore } = await import('../src/lib/ai/result.svelte.ts');
    const server = fakeServer(() =>
      sse([
        ['delta', { text: '<think>…</think>\n## Tóm tắt\n' }],
        ['delta', { text: 'Đổi tiêu đề.' }],
        ['done', { usage: {} }],
      ]),
    );
    const { store: ai } = makeStore(server);
    ai.saved.consented = true;
    ai.saved.installId = '0f8fad5b-d9cb-469f-a165-70867728950e';
    ai.saved.token = 'tok';
    const result = new AiResultStore(ai);
    const preview = {
      feature: 'explain' as const,
      branch: null,
      files: [],
      skipped: [],
      redactions: 0,
      subjects: [],
    };
    await result.open({
      title: 'x',
      feature: 'explain',
      prepare: async () => ({
        request: { files: [], skipped: REQUEST.skipped, message: 'm', language: 'vi' },
        preview,
      }),
      emptyText: 'trống',
    });
    expect(result.phase).toBe('done');
    expect(result.text).toBe('## Tóm tắt\nĐổi tiêu đề.');
    await result.open({ title: 'y', feature: 'explain', prepare: async () => null, emptyText: 'trống' });
    expect([result.phase, result.error]).toEqual(['error', 'trống']);
    expect(server.calls.filter((call) => call.url.endsWith('/explain-commit'))).toHaveLength(1);
  });
});
