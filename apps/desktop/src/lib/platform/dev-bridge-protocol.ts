/**
 * Wire protocol of the DEV bridge (see `dev/bridge-plugin.ts`), shared by the server side (the Vite
 * plugin) and the browser side. Only `dev-bridge-client.ts` (loaded through `import()` when
 * `import.meta.env.DEV`) imports this file, so builds never contain it.
 */
import type { EnvProfile, ExecKind, OpenedRepo, RepoChangeKind } from '@thaigit/contracts';
import type { RecentRepo } from '../ipc/types.ts';

export const BRIDGE_PATH = '/__thaigit_dev';
export const TOKEN_HEADER = 'x-thaigit-token';
/** `<meta name="thaigit-dev-bridge" content="TOKEN" data-auto-open="1">` — only injected by the plugin while running dev. */
export const BRIDGE_META = 'thaigit-dev-bridge';
export const DEV_REPO_ID = 'dev-repo';

export interface BridgeExecBody {
  sub: string;
  args: string[];
  kind: ExecKind;
  env?: Record<string, string>;
  profile?: EnvProfile;
  /** base64 */
  stdin?: string;
}

export interface BridgeInfo {
  repo: OpenedRepo;
  recent: RecentRepo[];
}

export interface BridgeChanges {
  /** Sequence number of the newest event; send it back as `after` on the next poll. */
  seq: number;
  /** Empty = the wait timed out (poll again). */
  kinds: RepoChangeKind[];
}

export interface BridgeError {
  code: 'policy' | 'not-found' | 'out-of-scope' | 'io' | 'internal';
  message: string;
}

export interface ExecFrame {
  code: number;
  cancelled: boolean;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

const HEADER_BYTES = 13;

/** `/exec` response body: `[i32 exit code][u8 cancelled][u32 stderr length][u32 stdout length][stderr][stdout]` (little-endian). */
export function encodeExecFrame(frame: ExecFrame): Uint8Array {
  const out = new Uint8Array(HEADER_BYTES + frame.stderr.length + frame.stdout.length);
  const view = new DataView(out.buffer);
  view.setInt32(0, frame.code, true);
  view.setUint8(4, frame.cancelled ? 1 : 0);
  view.setUint32(5, frame.stderr.length, true);
  view.setUint32(9, frame.stdout.length, true);
  out.set(frame.stderr, HEADER_BYTES);
  out.set(frame.stdout, HEADER_BYTES + frame.stderr.length);
  return out;
}

export function decodeExecFrame(bytes: Uint8Array): ExecFrame {
  if (bytes.length < HEADER_BYTES) throw new Error('Phản hồi exec của cầu nối dev quá ngắn');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stderrLength = view.getUint32(5, true);
  const stdoutLength = view.getUint32(9, true);
  if (HEADER_BYTES + stderrLength + stdoutLength !== bytes.length) {
    throw new Error('Phản hồi exec của cầu nối dev sai độ dài');
  }
  return {
    code: view.getInt32(0, true),
    cancelled: view.getUint8(4) === 1,
    stderr: bytes.subarray(HEADER_BYTES, HEADER_BYTES + stderrLength),
    stdout: bytes.subarray(HEADER_BYTES + stderrLength),
  };
}
