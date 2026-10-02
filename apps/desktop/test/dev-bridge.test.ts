// Cầu nối DEV (dev/bridge-plugin.ts): kiểm đường chạy THẬT — dựng một Vite dev server với plugin trên một repo tạm rồi gọi qua HTTP
// như trình duyệt: token/Host/Origin, chỉ-đọc (không bao giờ ghi repo), khung exec, theo dõi thay đổi, và `RepoStore` chạy trọn
// vòng qua client của cầu nối.
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitPolicy } from '@thaigit/contracts';
import { createServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { thaigitDevBridge, type DevBridgeOptions } from '../dev/bridge-plugin.ts';
import { checkReadOnly } from '../dev/read-only-gate.ts';
import {
  BRIDGE_PATH,
  TOKEN_HEADER,
  decodeExecFrame,
  encodeExecFrame,
  type BridgeChanges,
  type BridgeError,
  type BridgeInfo,
} from '../src/lib/platform/dev-bridge-protocol.ts';
import { PrefsStore } from '../src/lib/stores/prefs.svelte.ts';
import { RepoStore } from '../src/lib/stores/repo.svelte.ts';
import { ToastStore } from '../src/lib/stores/toasts.svelte.ts';
import { rawGit } from './helpers/node-port.ts';

const DESKTOP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const realFetch = globalThis.fetch;
const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('checkReadOnly (cổng chỉ-đọc theo chính sách)', () => {
  const check = (kind: 'read' | 'write' | 'network', sub: string, ...args: string[]) =>
    checkReadOnly(gitPolicy, kind, sub, args);

  it('cho phép lệnh đọc và dạng chỉ-đọc của lệnh "write" (GitRunner yêu cầu kind write cho chúng)', () => {
    expect(check('read', 'log', '-z').ok).toBe(true);
    expect(check('read', 'status', '--porcelain=v2').ok).toBe(true);
    expect(check('read', 'for-each-ref').ok).toBe(true);
    expect(check('write', 'stash', 'list', '-z').ok).toBe(true);
    expect(check('write', 'remote', '-v').ok).toBe(true);
    expect(check('write', 'remote').ok).toBe(true);
  });

  it('từ chối mọi thao tác ghi, kể cả khi phía gọi khai kind "read"', () => {
    for (const [sub, args] of [
      ['commit', ['-m', 'x']],
      ['add', ['.']],
      ['stash', ['pop']],
      ['stash', ['push']],
      ['remote', ['remove', 'origin']],
      ['remote', ['show', 'origin']],
      ['checkout', ['main']],
      ['reset', ['--hard']],
      ['tag', ['v1']],
      ['branch', ['-D', 'x']],
    ] as const) {
      expect(check('read', sub, ...args).ok, `${sub} ${args.join(' ')}`).toBe(false);
    }
  });

  it('từ chối lệnh mạng và subcommand ngoài chính sách', () => {
    expect(check('network', 'log').ok).toBe(false);
    expect(check('read', 'fetch', '--all').ok).toBe(false);
    expect(check('read', 'pull').ok).toBe(false);
    expect(check('read', 'push').ok).toBe(false);
    expect(check('read', 'ls-remote').ok).toBe(false);
    expect(check('read', 'nope').ok).toBe(false);
    expect(check('read', '__proto__').ok).toBe(false);
  });

  it('từ chối diff --no-index (đọc file tuỳ ý trên máy)', () => {
    expect(check('read', 'diff', '--no-index', '--', '/dev/null', '/etc/passwd').ok).toBe(false);
    expect(check('read', 'diff', '--cached', '-M', '--', 'a.txt').ok).toBe(true);
  });
});

describe('khung exec nhị phân', () => {
  it('mã hoá rồi giải mã giữ nguyên mã thoát, cờ huỷ, stderr và stdout (byte bất kỳ)', () => {
    const stdout = Uint8Array.from([0, 255, 1, 2, 3, 0x0a]);
    const stderr = new TextEncoder().encode('lỗi một dòng\n');
    const frame = decodeExecFrame(encodeExecFrame({ code: -7, cancelled: true, stdout, stderr }));
    expect(frame.code).toBe(-7);
    expect(frame.cancelled).toBe(true);
    expect([...frame.stdout]).toEqual([...stdout]);
    expect(new TextDecoder().decode(frame.stderr)).toBe('lỗi một dòng\n');
  });

  it('từ chối khung ngắn hoặc sai độ dài', () => {
    expect(() => decodeExecFrame(new Uint8Array(5))).toThrow();
    const good = encodeExecFrame({
      code: 0,
      cancelled: false,
      stdout: new Uint8Array(4),
      stderr: new Uint8Array(0),
    });
    expect(() => decodeExecFrame(good.subarray(0, good.length - 1))).toThrow();
  });
});

// --- dựng server thật -----------------------------------------------------------------------------------------------------

interface Bridge {
  server: ViteDevServer;
  base: string;
  token: string;
  repo: string;
  html: string;
  request(path: string, init?: RequestInit & { token?: string | null }): Promise<Response>;
  exec(sub: string, args: string[], kind?: 'read' | 'write' | 'network'): Promise<Response>;
}

async function makeRepo(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'thaigit-bridge-test-')));
  cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  rawGit(root, ['init', '-q', '-b', 'main', '.']);
  await writeFile(join(root, 'a.txt'), 'một\n');
  rawGit(root, ['add', '.']);
  rawGit(root, ['commit', '-q', '-m', 'Khởi tạo']);
  return root;
}

async function startBridge(options: Partial<DevBridgeOptions> = {}): Promise<Bridge> {
  const repo = options.repo ?? (await makeRepo());
  const server = await createServer({
    root: DESKTOP_ROOT,
    configFile: false,
    logLevel: 'silent',
    clearScreen: false,
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [thaigitDevBridge({ repo, autoOpen: false, trust: 'trusted', ...options })],
  });
  await server.listen();
  cleanups.push(() => server.close());
  const base = `http://127.0.0.1:${(server.httpServer?.address() as AddressInfo).port}`;
  const html = await server.transformIndexHtml('/', '<!doctype html><html><head></head><body></body></html>');
  const token = /name="thaigit-dev-bridge" content="([^"]+)"/.exec(html)?.[1] ?? '';
  const request: Bridge['request'] = (path, init = {}) => {
    const { token: override, headers, ...rest } = init;
    const useToken = override === undefined ? token : override;
    return realFetch(`${base}${BRIDGE_PATH}${path}`, {
      ...rest,
      headers: { ...(useToken === null ? {} : { [TOKEN_HEADER]: useToken }), ...headers },
    });
  };
  const exec: Bridge['exec'] = (sub, args, kind = 'read') =>
    request('/exec', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sub, args, kind }),
    });
  return { server, base, token, repo, html, request, exec };
}

async function failure(response: Response): Promise<BridgeError> {
  return (await response.json()) as BridgeError;
}

describe('plugin: bảo vệ truy cập', () => {
  it('không có THAIGIT_DEV_REPO → không chèn token, không có đường vào', async () => {
    const bridge = await startBridge({ repo: undefined });
    expect(bridge.html).not.toContain('thaigit-dev-bridge');
    const response = await realFetch(`${bridge.base}${BRIDGE_PATH}/info`, {
      headers: { [TOKEN_HEADER]: 'x' },
    });
    expect(response.status).not.toBe(200);
  });

  it('token chỉ nằm trong <meta> lúc dev; mỗi lần khởi động một token khác nhau', async () => {
    const a = await startBridge();
    const b = await startBridge();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.html).not.toContain('data-auto-open');
  });

  it('thiếu/sai token → 401, đúng token → 200', async () => {
    const bridge = await startBridge();
    expect((await bridge.request('/info', { token: null })).status).toBe(401);
    expect((await bridge.request('/info', { token: 'sai-token' })).status).toBe(401);
    expect((await bridge.request('/info', { token: `${bridge.token}x` })).status).toBe(401);
    const ok = await bridge.request('/info');
    expect(ok.status).toBe(200);
    const info = (await ok.json()) as BridgeInfo;
    expect(info.repo).toMatchObject({
      repoId: 'dev-repo',
      root: bridge.repo,
      trust: 'trusted',
      findings: [],
    });
    expect(info.recent).toHaveLength(1);
    expect(Number.isInteger(info.recent[0]?.lastOpened)).toBe(true);
  });

  it('Origin khác nguồn → 403 (trang web khác không gọi được dù biết token)', async () => {
    const bridge = await startBridge();
    const response = await bridge.request('/info', { headers: { origin: 'http://evil.example' } });
    expect(response.status).toBe(403);
    expect((await failure(response)).code).toBe('policy');
    const same = await bridge.request('/info', { headers: { origin: bridge.base } });
    expect(same.status).toBe(200);
  });

  it('autoOpen được báo qua thuộc tính data-auto-open của <meta>', async () => {
    const bridge = await startBridge({ autoOpen: true });
    expect(bridge.html).toContain('data-auto-open="1"');
  });

  it('đường dẫn lạ → 404; thân quá lớn → 413; thân không phải JSON → 400', async () => {
    const bridge = await startBridge();
    expect((await bridge.request('/khong-co')).status).toBe(404);
    const huge = JSON.stringify({ sub: 'log', args: ['x'.repeat(1_100_000)], kind: 'read' });
    const big = await bridge.request('/exec', {
      method: 'POST',
      body: huge,
      headers: { 'content-type': 'application/json' },
    });
    expect(big.status).toBe(413);
    const bad = await bridge.request('/exec', { method: 'POST', body: 'không phải json' });
    expect(bad.status).toBe(400);
    const malformed = await bridge.request('/exec', { method: 'POST', body: JSON.stringify({ sub: 'log' }) });
    expect(malformed.status).toBe(400);
  });
});

describe('plugin: chạy git chỉ-đọc', () => {
  it('đọc: for-each-ref, log, status chạy qua NodeExec và trả khung có mã thoát 0', async () => {
    const bridge = await startBridge();
    const refs = decodeExecFrame(
      new Uint8Array(
        await (await bridge.exec('for-each-ref', ['--format=%(refname)', 'refs/heads'])).arrayBuffer(),
      ),
    );
    expect(refs.code).toBe(0);
    expect(new TextDecoder().decode(refs.stdout).trim()).toBe('refs/heads/main');
    const log = decodeExecFrame(
      new Uint8Array(await (await bridge.exec('log', ['--format=%s', '-1'])).arrayBuffer()),
    );
    expect(new TextDecoder().decode(log.stdout).trim()).toBe('Khởi tạo');
  });

  it('mọi thao tác ghi/mạng bị từ chối và repo KHÔNG đổi', async () => {
    const bridge = await startBridge();
    const headBefore = rawGit(bridge.repo, ['rev-parse', 'HEAD']);
    const statusBefore = rawGit(bridge.repo, ['status', '--porcelain']);
    const attempts: [string, string[], ('read' | 'write' | 'network')?][] = [
      ['commit', ['--allow-empty', '-m', 'tấn công'], 'read'],
      ['commit', ['--allow-empty', '-m', 'tấn công'], 'write'],
      ['add', ['.'], 'write'],
      ['stash', ['push', '-u'], 'write'],
      ['reset', ['--hard', 'HEAD~1'], 'write'],
      ['tag', ['v-evil'], 'write'],
      ['branch', ['evil'], 'write'],
      ['fetch', ['--all'], 'network'],
      ['push', ['origin', 'main'], 'network'],
      ['remote', ['add', 'evil', 'https://example.com/x.git'], 'write'],
      ['config', ['--global', 'user.name', 'x'], 'read'],
    ];
    for (const [sub, args, kind] of attempts) {
      const response = await bridge.exec(sub, args, kind);
      expect(response.status, `${sub} ${args.join(' ')} (${kind})`).toBe(403);
      expect((await failure(response)).code).toBe('policy');
    }
    expect(rawGit(bridge.repo, ['rev-parse', 'HEAD'])).toBe(headBefore);
    expect(rawGit(bridge.repo, ['status', '--porcelain'])).toBe(statusBefore);
    expect(rawGit(bridge.repo, ['tag'])).toBe('');
    expect(rawGit(bridge.repo, ['branch', '--list'])).toBe('* main\n');
  });

  it('chính sách của NodeExec vẫn áp dụng (cờ nguy hiểm bị chặn), diff --no-index bị chặn', async () => {
    const bridge = await startBridge();
    const output = await bridge.exec('log', ['--output=/tmp/thaigit-evil.txt']);
    expect(output.status).toBe(403);
    expect((await failure(output)).message).toContain('--output');
    const noIndex = await bridge.exec('diff', ['--no-index', '--', '/dev/null', '/etc/passwd']);
    expect(noIndex.status).toBe(403);
  });

  it('git-file: file vắng → 204; ngoài danh sách cho phép → 403', async () => {
    const bridge = await startBridge();
    expect((await bridge.request('/git-file?rel=MERGE_HEAD')).status).toBe(204);
    const blocked = await bridge.request('/git-file?rel=config');
    expect(blocked.status).toBe(403);
    expect((await failure(blocked)).code).toBe('out-of-scope');
    const traversal = await bridge.request(`/git-file?rel=${encodeURIComponent('../../etc/passwd')}`);
    expect(traversal.status).toBe(403);
  });

  it('giả lập repo lạ: trust "unknown" cho tới khi gọi /trust', async () => {
    const bridge = await startBridge({ trust: 'unknown' });
    const before = (await (await bridge.request('/info')).json()) as BridgeInfo;
    expect(before.repo.trust).toBe('unknown');
    expect(before.repo.findings.length).toBeGreaterThan(0);
    const trusted = (await (await bridge.request('/trust', { method: 'POST' })).json()) as BridgeInfo['repo'];
    expect(trusted).toMatchObject({ trust: 'trusted', findings: [] });
    const after = (await (await bridge.request('/info')).json()) as BridgeInfo;
    expect(after.repo.trust).toBe('trusted');
  });

  it('theo dõi thay đổi (long-poll): sửa file → loại workingTree; commit → refs', async () => {
    const bridge = await startBridge();
    const baseline = (await (await bridge.request('/changes')).json()) as BridgeChanges;
    expect(baseline.kinds).toEqual([]);
    const pending = bridge
      .request(`/changes?after=${baseline.seq}`)
      .then((response) => response.json() as Promise<BridgeChanges>);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(join(bridge.repo, 'moi.txt'), 'mới\n');
    const first = await pending;
    expect(first.seq).toBeGreaterThan(baseline.seq);
    expect(first.kinds).toContain('workingTree');

    const next = bridge
      .request(`/changes?after=${first.seq}`)
      .then((response) => response.json() as Promise<BridgeChanges>);
    await new Promise((resolve) => setTimeout(resolve, 100));
    rawGit(bridge.repo, ['add', '.']);
    rawGit(bridge.repo, ['commit', '-q', '-m', 'Từ terminal']);
    const second = await next;
    expect(second.kinds).toContain('refs');
  });
});

describe('client của cầu nối + RepoStore (trọn vòng như trình duyệt)', () => {
  it('mở repo cố định, nạp lịch sử, nhận sự kiện watcher và làm mới', async () => {
    const bridge = await startBridge({ autoOpen: true });
    // Giả lập môi trường trình duyệt: <meta> và fetch với URL tương đối.
    vi.stubGlobal('document', {
      querySelector: () => ({ content: bridge.token, dataset: { autoOpen: '1' } }),
    });
    vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) =>
      realFetch(new URL(String(input), bridge.base), init),
    );
    const { createDevBridgeHost } = await import('../src/lib/platform/dev-bridge-client.ts');
    const host = createDevBridgeHost();
    expect(host?.kind).toBe('dev-bridge');
    const recent = await host!.listRecentRepos();
    expect(recent.map((repo) => repo.path)).toEqual([bridge.repo]);

    const port = await host!.openLaunchRepo();
    expect(port?.info.root).toBe(bridge.repo);
    const store = new RepoStore(port!, {
      prefs: new PrefsStore(null),
      toasts: new ToastStore(),
      detailsDelayMs: 0,
    });
    cleanups.push(() => store.dispose());
    await store.start();
    await until(() => store.hasLoaded);
    expect(store.entries.map((entry) => entry.commit.subject)).toEqual(['Khởi tạo']);
    expect(store.currentBranch).toBe('main');

    // Ghi bị từ chối ở cả hai lớp: client (fs/typedGit) và server.
    await expect(port!.fs.writeWorktreeFile('a.txt', new Uint8Array(), null)).rejects.toThrow(/chỉ đọc/);
    await expect(port!.typedGit?.configSet('user.name', 'x', 'local')).rejects.toThrow(/chỉ đọc/);
    await expect(store.git.commit('x', { allowEmpty: true })).rejects.toThrow(/chỉ đọc|chính sách/);

    // File mới trong repo → watcher của cầu nối → store làm mới và hiện dòng WIP.
    await writeFile(join(bridge.repo, 'chua-track.txt'), 'x\n');
    await until(() => store.hasWorkingTreeRow);
    expect(store.status.unstaged.map((change) => change.path)).toEqual(['chua-track.txt']);

    // Commit từ terminal → lịch sử nạp lại.
    rawGit(bridge.repo, ['add', '.']);
    rawGit(bridge.repo, ['commit', '-q', '-m', 'Commit thứ hai']);
    await until(() => store.entries[0]?.commit.subject === 'Commit thứ hai');
    expect(store.hasWorkingTreeRow).toBe(false);
  });

  it('không có <meta> (trang không chạy qua plugin) → không tạo host cầu nối', async () => {
    vi.stubGlobal('document', { querySelector: () => null });
    const { createDevBridgeHost } = await import('../src/lib/platform/dev-bridge-client.ts');
    expect(createDevBridgeHost()).toBeNull();
  });
});

async function until(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Hết giờ chờ điều kiện');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
