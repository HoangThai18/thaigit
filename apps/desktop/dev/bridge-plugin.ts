/**
 * Cầu nối DEV: chạy giao diện trong trình duyệt thường (headless Chrome) bằng git THẬT của MỘT repo, để chụp ảnh và đo
 * hiệu năng mà không mở cửa sổ Tauri. Chỉ có trong `vite` (dev server): `apply: 'serve'`, bản build không có đường vào nào.
 *
 *   THAIGIT_DEV_REPO=/đường/dẫn/repo pnpm --filter @thaigit/desktop dev --port 1430 --host 127.0.0.1
 *   (tuỳ chọn) THAIGIT_DEV_AUTOOPEN=1  mở repo ngay khi tải trang (như "Mở bằng…")
 *   (tuỳ chọn) THAIGIT_DEV_TRUST=unknown  giả lập repo lạ để thử hộp thoại tin tưởng
 *
 * An toàn (dev server chạy trên máy lập trình viên, nên vẫn đóng cửa từng lớp):
 *  - chỉ hoạt động khi có `THAIGIT_DEV_REPO` và dev server nghe trên loopback;
 *  - mọi yêu cầu cần token ngẫu nhiên mỗi lần khởi động, chỉ chèn vào trang lúc dev (`<meta>`); kiểm Host + Origin;
 *  - CHỈ ĐỌC: lệnh phải là dạng chỉ-đọc theo chính sách (không tin `kind` phía gọi), không lệnh mạng, không ghi file;
 *  - git chạy qua `NodeExec` của `@thaigit/core/node` (kiểm `git-policy.json` như Rust), đúng MỘT repo cố định.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { statSync, watch, type FSWatcher } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, sep } from 'node:path';
import type { OpenedRepo, RepoChangeKind } from '@thaigit/contracts';
import type { Plugin, ViteDevServer } from 'vite';
import {
  BRIDGE_META,
  BRIDGE_PATH,
  DEV_REPO_ID,
  TOKEN_HEADER,
  encodeExecFrame,
  type BridgeChanges,
  type BridgeError,
  type BridgeExecBody,
  type BridgeInfo,
} from '../src/lib/platform/dev-bridge-protocol.ts';
import { checkReadOnly, type KindOf } from './read-only-gate.ts';

type CoreNode = typeof import('@thaigit/core/node');
type Core = typeof import('@thaigit/core');
type Contracts = typeof import('@thaigit/contracts');

export interface DevBridgeOptions {
  /** Repo duy nhất cầu nối phục vụ. Thiếu → cầu nối tắt. */
  repo: string | undefined;
  autoOpen: boolean;
  trust: 'trusted' | 'unknown';
}

export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): DevBridgeOptions {
  return {
    repo: env.THAIGIT_DEV_REPO?.trim() || undefined,
    autoOpen: env.THAIGIT_DEV_AUTOOPEN === '1',
    trust: env.THAIGIT_DEV_TRUST === 'unknown' ? 'unknown' : 'trusted',
  };
}

const MAX_BODY_BYTES = 1024 * 1024;
const LONG_POLL_MS = 20_000;
const WATCH_DEBOUNCE_MS = 150;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: BridgeError['code'],
    message: string,
  ) {
    super(message);
  }
}

/** Lỗi từ bộ chuyển Node (`AdapterError` mang `code` của IPC) → phản hồi HTTP cùng mã. */
function adapterFailure(error: unknown): HttpError {
  const code = (error as { code?: string }).code;
  const message = error instanceof Error ? error.message : String(error);
  switch (code) {
    case 'policy':
      return new HttpError(403, 'policy', message);
    case 'out-of-scope':
      return new HttpError(403, 'out-of-scope', message);
    case 'not-found':
      return new HttpError(404, 'not-found', message);
    case 'io':
      return new HttpError(500, 'io', message);
    default:
      return new HttpError(500, 'internal', message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function sendBytes(res: ServerResponse, bytes: Uint8Array): void {
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': String(bytes.length),
    'cache-control': 'no-store',
  });
  res.end(bytes);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new HttpError(413, 'policy', 'Thân yêu cầu quá lớn.');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'policy', 'Thân yêu cầu không phải JSON.');
  }
}

function parseExecBody(value: unknown): BridgeExecBody {
  const body = value as Partial<BridgeExecBody> | null;
  const kinds = ['read', 'write', 'network'];
  if (
    typeof body !== 'object' ||
    body === null ||
    typeof body.sub !== 'string' ||
    !Array.isArray(body.args) ||
    !body.args.every((arg) => typeof arg === 'string') ||
    typeof body.kind !== 'string' ||
    !kinds.includes(body.kind)
  ) {
    throw new HttpError(400, 'policy', 'Yêu cầu exec sai định dạng.');
  }
  return body as BridgeExecBody;
}

function tokenMatches(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Phân loại đường dẫn (tương đối với gốc repo) thành loại thay đổi; `.git/*` theo bảng luật chung với Rust. */
export function classifyChange(core: Pick<Core, 'classifyGitPath'>, relativePath: string): RepoChangeKind[] {
  const posix = relativePath.split(sep).join('/');
  if (posix === '.git' || posix.startsWith('.git/')) return core.classifyGitPath(posix.slice('.git/'.length));
  // Dev: không đọc .gitignore (Rust làm việc đó); chỉ bỏ thư mục phụ thuộc cho khỏi ồn.
  if (posix.split('/').includes('node_modules')) return [];
  return ['workingTree'];
}

interface BridgeRuntime {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  dispose(): void;
}

async function createRuntime(
  server: ViteDevServer,
  options: DevBridgeOptions & { repo: string },
  token: string,
): Promise<BridgeRuntime> {
  // Nạp qua bộ nạp SSR của Vite: các package workspace này là TS thuần (có "parameter property") nên Node gốc không chạy được.
  const nodeCore = (await server.ssrLoadModule('@thaigit/core/node')) as CoreNode;
  const core = (await server.ssrLoadModule('@thaigit/core')) as Core;
  const { effectiveKind, gitPolicy } = (await server.ssrLoadModule('@thaigit/contracts')) as Contracts;
  const kindOf: KindOf = (sub, args) => effectiveKind(sub, args, gitPolicy);

  const location = await nodeCore.locateRepository(options.repo);
  const exec = new nodeCore.NodeExec({ cwd: location.root, gitDir: location.gitDir });
  const fs = new nodeCore.NodeRepoFs({ ...location });

  let trust: OpenedRepo['trust'] = options.trust;
  const findings =
    options.trust === 'unknown'
      ? ['(mô phỏng) core.fsmonitor — .git/config', '(mô phỏng) hook: .git/hooks/pre-commit']
      : [];
  const opened = (): OpenedRepo => ({
    repoId: DEV_REPO_ID,
    root: location.root,
    gitDir: location.gitDir,
    commonDir: location.commonDir,
    trust,
    findings: trust === 'unknown' ? findings : [],
  });
  const lastActivity = (): number => {
    try {
      return Math.round(statSync(location.gitDir).mtimeMs);
    } catch {
      return Date.now();
    }
  };

  // --- theo dõi thay đổi (long-poll) -------------------------------------------------------------------------------
  let seq = 0;
  const events: { seq: number; kinds: RepoChangeKind[] }[] = [];
  const waiters = new Set<() => void>();
  const pending = new Set<RepoChangeKind>();
  let timer: NodeJS.Timeout | undefined;
  const flush = (): void => {
    timer = undefined;
    if (pending.size === 0) return;
    events.push({ seq: ++seq, kinds: [...pending] });
    if (events.length > 100) events.splice(0, events.length - 100);
    pending.clear();
    for (const wake of [...waiters]) wake();
  };
  const onFsEvent = (_event: string, filename: string | Buffer | null): void => {
    if (filename === null) return;
    for (const kind of classifyChange(core, filename.toString())) pending.add(kind);
    if (pending.size > 0) timer ??= setTimeout(flush, WATCH_DEBOUNCE_MS);
  };
  const watchers: FSWatcher[] = [];
  try {
    watchers.push(watch(location.root, { recursive: true, persistent: false }, onFsEvent));
  } catch (error) {
    server.config.logger.warn(`[thaigit-dev-bridge] không theo dõi được thay đổi: ${String(error)}`);
  }

  const changesSince = (after: number): BridgeChanges | null => {
    const fresh = events.filter((event) => event.seq > after);
    if (fresh.length === 0) return null;
    return { seq, kinds: [...new Set(fresh.flatMap((event) => event.kinds))] };
  };

  // --- định tuyến ---------------------------------------------------------------------------------------------------
  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    switch (`${method} ${url.pathname}`) {
      case 'GET /info': {
        const info: BridgeInfo = {
          repo: opened(),
          recent: [
            {
              id: DEV_REPO_ID,
              name: basename(location.root),
              path: location.root,
              lastOpened: lastActivity(),
            },
          ],
        };
        return sendJson(res, 200, info);
      }
      case 'POST /trust': {
        trust = 'trusted';
        return sendJson(res, 200, opened());
      }
      case 'POST /exec': {
        const body = parseExecBody(await readJson(req));
        const verdict = checkReadOnly(kindOf, body.kind, body.sub, body.args);
        if (!verdict.ok) throw new HttpError(403, 'policy', verdict.message);
        try {
          const result = await exec.run({
            kind: 'read',
            sub: body.sub,
            args: body.args,
            env: body.env,
            profile: body.profile,
            stdin: body.stdin === undefined ? undefined : new Uint8Array(Buffer.from(body.stdin, 'base64')),
          });
          return sendBytes(res, encodeExecFrame(result));
        } catch (error) {
          throw adapterFailure(error);
        }
      }
      case 'GET /git-file': {
        const rel = url.searchParams.get('rel') ?? '';
        let bytes: Uint8Array | null;
        try {
          bytes = await fs.readGitFile(rel);
        } catch (error) {
          throw adapterFailure(error);
        }
        // 204 (không phải 404): file vắng là chuyện bình thường (không có MERGE_HEAD…), khỏi làm console báo lỗi tải tài nguyên.
        if (bytes === null) {
          res.writeHead(204, { 'cache-control': 'no-store' });
          res.end();
          return;
        }
        return sendBytes(res, bytes);
      }
      case 'GET /worktree-file': {
        const rel = url.searchParams.get('rel') ?? '';
        const max = Number(url.searchParams.get('max') ?? '');
        let bytes: Uint8Array | null;
        try {
          bytes = await fs.readWorktreeFile(rel, Number.isFinite(max) && max > 0 ? max : undefined);
        } catch (error) {
          throw adapterFailure(error);
        }
        if (bytes === null) {
          res.writeHead(204, { 'cache-control': 'no-store' });
          res.end();
          return;
        }
        return sendBytes(res, bytes);
      }
      case 'GET /changes': {
        const afterParam = url.searchParams.get('after');
        if (afterParam === null) return sendJson(res, 200, { seq, kinds: [] } satisfies BridgeChanges);
        const after = Number(afterParam);
        if (!Number.isFinite(after)) throw new HttpError(400, 'policy', 'Tham số after sai.');
        const ready = changesSince(after);
        if (ready) return sendJson(res, 200, ready);
        await new Promise<void>((resolve) => {
          const done = (): void => {
            clearTimeout(timeout);
            waiters.delete(done);
            resolve();
          };
          const timeout = setTimeout(done, LONG_POLL_MS);
          waiters.add(done);
          res.once('close', done);
        });
        if (res.writableEnded || res.destroyed) return;
        return sendJson(res, 200, changesSince(after) ?? ({ seq, kinds: [] } satisfies BridgeChanges));
      }
      default:
        throw new HttpError(404, 'not-found', 'Không có đường dẫn này.');
    }
  }

  return {
    async handle(req, res) {
      try {
        // Chống DNS rebinding / trang web khác gọi vào dev server: Host phải là loopback, Origin (nếu có) phải cùng nguồn.
        const host = (req.headers.host ?? '').replace(/:\d+$/, '');
        if (!LOOPBACK_HOSTS.has(host)) throw new HttpError(403, 'policy', 'Host không hợp lệ.');
        const origin = req.headers.origin;
        if (origin !== undefined && origin !== `http://${req.headers.host}`) {
          throw new HttpError(403, 'policy', 'Origin không hợp lệ.');
        }
        const header = req.headers[TOKEN_HEADER];
        if (!tokenMatches(Array.isArray(header) ? header[0] : header, token)) {
          throw new HttpError(401, 'policy', 'Thiếu hoặc sai token của cầu nối dev.');
        }
        await route(req, res);
      } catch (error) {
        const http =
          error instanceof HttpError ? error : new HttpError(500, 'internal', (error as Error).message);
        if (!res.headersSent)
          sendJson(res, http.status, { code: http.code, message: http.message } satisfies BridgeError);
      }
    },
    dispose() {
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
      for (const wake of [...waiters]) wake();
    },
  };
}

function isLoopbackBinding(host: ViteDevServer['config']['server']['host']): boolean {
  return host === undefined || host === false || (typeof host === 'string' && LOOPBACK_HOSTS.has(host));
}

export function thaigitDevBridge(options: DevBridgeOptions = optionsFromEnv()): Plugin {
  const token = randomBytes(24).toString('base64url');
  const repo = options.repo;
  let enabled = repo !== undefined;

  return {
    name: 'thaigit-dev-bridge',
    apply: 'serve',

    configResolved(config) {
      if (!enabled) return;
      if (!isLoopbackBinding(config.server.host)) {
        enabled = false;
        config.logger.warn('[thaigit-dev-bridge] dev server không nghe trên loopback: cầu nối dev bị tắt.');
      }
    },

    transformIndexHtml() {
      if (!enabled) return;
      return [
        {
          tag: 'meta',
          attrs: {
            name: BRIDGE_META,
            content: token,
            ...(options.autoOpen ? { 'data-auto-open': '1' } : {}),
          },
          injectTo: 'head',
        },
      ];
    },

    configureServer(server) {
      if (!enabled || repo === undefined) return;
      let runtime: Promise<BridgeRuntime> | undefined;
      const get = (): Promise<BridgeRuntime> =>
        (runtime ??= createRuntime(server, { ...options, repo }, token));
      server.middlewares.use(BRIDGE_PATH, (req, res) => {
        get().then(
          (bridge) => bridge.handle(req, res),
          (error: unknown) => {
            if (!res.headersSent)
              sendJson(res, 500, { code: 'internal', message: String(error) } satisfies BridgeError);
          },
        );
      });
      server.httpServer?.once('close', () => void runtime?.then((bridge) => bridge.dispose()));
      server.config.logger.info(`[thaigit-dev-bridge] repo: ${repo} (chỉ đọc, 127.0.0.1)`);
    },
  };
}
