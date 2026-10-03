/**
 * Phía trình duyệt của cầu nối DEV (xem `dev/bridge-plugin.ts`): cài đặt `Host` bằng HTTP tới dev server. CHỈ nạp bằng
 * `import()` có điều kiện `import.meta.env.DEV` (host.ts) — bản build không chứa file này. Chỉ đọc: mọi thao tác ghi bị từ chối.
 */
import type { OpenedRepo, RepoChangedEvent } from '@thaigit/contracts';
import type { RepoFs, TypedGit } from '@thaigit/core';
import { CommandFailure } from '../ipc/errors.ts';
import { bytesToBase64 } from '../ipc/gitExec.ts';
import type { Host, RepoPort } from './host.ts';
import {
  BRIDGE_META,
  BRIDGE_PATH,
  TOKEN_HEADER,
  decodeExecFrame,
  type BridgeChanges,
  type BridgeError,
  type BridgeExecBody,
  type BridgeInfo,
} from './dev-bridge-protocol.ts';

const READ_ONLY = 'Cầu nối dev chỉ đọc: thao tác ghi cần chạy trong app Tauri.';

/** Mọi thao tác ghi: trả promise bị từ chối (không ném đồng bộ) để người gọi `.catch()` / `await` đều bắt được. */
function refuse(): Promise<never> {
  return Promise.reject(new CommandFailure('policy', READ_ONLY));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createDevBridgeHost(): Host | null {
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${BRIDGE_META}"]`);
  const content = meta?.content;
  if (!meta || !content) return null;
  const token: string = content;
  const autoOpen = meta.dataset.autoOpen === '1';

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${BRIDGE_PATH}${path}`, {
      ...init,
      headers: { ...init.headers, [TOKEN_HEADER]: token },
    });
    if (response.ok) return response;
    let failure: BridgeError | undefined;
    try {
      failure = (await response.json()) as BridgeError;
    } catch {
      // thân không phải JSON
    }
    throw new CommandFailure(
      failure?.code ?? 'internal',
      failure?.message ?? `Cầu nối dev trả HTTP ${response.status}`,
    );
  }

  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await (await request(path, init)).json()) as T;
  }

  const fs: RepoFs = {
    async readGitFile(relative) {
      const response = await request(`/git-file?rel=${encodeURIComponent(relative)}`);
      return response.status === 204 ? null : new Uint8Array(await response.arrayBuffer());
    },
    readWorktreeFile: refuse,
    writeWorktreeFile: refuse,
    appendGitignore: refuse,
    trashUntracked: refuse,
    restoreTrash: refuse,
  };

  const typedGit: TypedGit = { configSet: refuse, remoteAdd: refuse, remoteSetUrl: refuse };

  function bind(info: OpenedRepo): RepoPort {
    return {
      info,
      fs,
      typedGit,
      exec: {
        async run(req) {
          const body: BridgeExecBody = {
            sub: req.sub,
            args: [...req.args],
            kind: req.kind,
            env: req.env ? { ...req.env } : undefined,
            profile: req.profile,
            stdin: req.stdin ? bytesToBase64(req.stdin) : undefined,
          };
          const response = await request('/exec', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          return decodeExecFrame(new Uint8Array(await response.arrayBuffer()));
        },
      },
      async watch(onChange: (event: RepoChangedEvent) => void) {
        const controller = new AbortController();
        let after = (await json<BridgeChanges>('/changes')).seq;
        void (async () => {
          while (!controller.signal.aborted) {
            try {
              const next = await json<BridgeChanges>(`/changes?after=${after}`, {
                signal: controller.signal,
              });
              after = next.seq;
              if (next.kinds.length > 0) onChange({ repoId: info.repoId, kinds: next.kinds });
            } catch {
              if (controller.signal.aborted) return;
              await delay(1000); // dev server khởi động lại: thử tiếp
            }
          }
        })();
        return async () => controller.abort();
      },
      async trust() {
        return bind(await json<OpenedRepo>('/trust', { method: 'POST' }));
      },
    };
  }

  const openDevRepo = async (): Promise<RepoPort> => bind((await json<BridgeInfo>('/info')).repo);

  return {
    kind: 'dev-bridge',
    pickAndOpenRepo: openDevRepo,
    openRecent: openDevRepo,
    async listRecentRepos() {
      return (await json<BridgeInfo>('/info')).recent;
    },
    async forgetRecentRepo() {
      // Danh sách "gần đây" của cầu nối là repo cố định: không có gì để quên.
    },
    openLaunchRepo: async () => (autoOpen ? openDevRepo() : null),
    // Cầu nối chỉ-đọc: không tạo / clone repo.
    pickFolder: refuse,
    cloneRepo: refuse,
    initRepo: refuse,
  };
}
