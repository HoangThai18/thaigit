/**
 * Browser side of the DEV bridge (see `dev/bridge-plugin.ts`): installs a `Host` talking HTTP to the dev
 * server. Loaded ONLY via a conditional `import()` guarded by `import.meta.env.DEV` (host.ts), so builds
 * never contain this file. Read-only: every write operation is refused.
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

/** Every write operation: returns a rejected promise (never throws synchronously) so callers can `.catch()` / `await` it either way. */
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
  // Write mode (THAIGIT_DEV_WRITE=1 on a scratch repo in the temp dir): file / typed operations go to the dev server.
  const writable = meta.dataset.write === '1';

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
      // body is not JSON
    }
    throw new CommandFailure(
      failure?.code ?? 'internal',
      failure?.message ?? `Cầu nối dev trả HTTP ${response.status}`,
    );
  }

  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await (await request(path, init)).json()) as T;
  }

  function call(target: 'fs' | 'typed', method: string) {
    return async (...args: unknown[]): Promise<never> => {
      const encoded = args.map((arg) => (arg instanceof Uint8Array ? { $b64: bytesToBase64(arg) } : arg));
      const { result } = await json<{ result: never }>('/call', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target, method, args: encoded }),
      });
      return result;
    };
  }
  const writer = (target: 'fs' | 'typed', method: string) => (writable ? call(target, method) : refuse);

  const fs: RepoFs = {
    async readGitFile(relative) {
      const response = await request(`/git-file?rel=${encodeURIComponent(relative)}`);
      return response.status === 204 ? null : new Uint8Array(await response.arrayBuffer());
    },
    async readWorktreeFile(relative, maxBytes) {
      const max = maxBytes === undefined ? '' : `&max=${maxBytes}`;
      const response = await request(`/worktree-file?rel=${encodeURIComponent(relative)}${max}`);
      return response.status === 204 ? null : new Uint8Array(await response.arrayBuffer());
    },
    writeWorktreeFile: writer('fs', 'writeWorktreeFile'),
    appendGitignore: writer('fs', 'appendGitignore'),
    trashUntracked: writer('fs', 'trashUntracked'),
    restoreTrash: writer('fs', 'restoreTrash'),
    prepareSnapshotIndex: writer('fs', 'prepareSnapshotIndex'),
  };

  const typedGit: TypedGit = {
    configSet: writer('typed', 'configSet'),
    remoteAdd: writer('typed', 'remoteAdd'),
    remoteSetUrl: writer('typed', 'remoteSetUrl'),
    worktreeAdd: writer('typed', 'worktreeAdd'),
    rebaseInteractive: writer('typed', 'rebaseInteractive'),
  };

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
              await delay(1000); // dev server restarted: keep polling
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
      // The bridge's "recent" list is a fixed repo: there is nothing to forget.
    },
    openLaunchRepo: async () => (autoOpen ? openDevRepo() : null),
    // Read-only bridge: never creates / clones a repo.
    pickFolder: refuse,
    cloneRepo: refuse,
    initRepo: refuse,
  };
}
