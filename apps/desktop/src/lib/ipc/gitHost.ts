import { Channel } from '@tauri-apps/api/core';
import { Commands, type OpenedRepo, type RebaseResult, type RebaseStepRequest } from '@thaigit/contracts';
import { toCommandFailure } from './errors.ts';
import { FrameCollector, type RawFrame, newOpId } from './gitExec.ts';
import { call } from './invoke.ts';
import type { ConfigScope } from './types.ts';

/** `destination` của `GitHost` trên Tauri là mã thư mục do hộp thoại native trả về, tuỳ chọn kèm tên thư mục con: `token` hoặc `token/tên`. */
export function splitDestination(destination: string): { token: string; name: string | null } {
  const slash = destination.indexOf('/');
  if (slash < 0) return { token: destination, name: null };
  const name = destination.slice(slash + 1);
  return { token: destination.slice(0, slash), name: name === '' ? null : name };
}

export interface CloneOptions {
  /** Mỗi dòng tiến độ của git ("Receiving objects: 45% …"). */
  onProgress?: (line: string) => void;
  /** Huỷ clone (huỷ theo bậc: mềm → cứng; thư mục dở dang được dọn). */
  signal?: AbortSignal;
}

function abortError(): Error {
  const error = new Error('Đã huỷ clone');
  error.name = 'AbortError';
  return error;
}

/**
 * Clone về thư mục do hộp thoại native chọn (URL được Rust kiểm: không `ext::`, `fd::`, không bắt đầu bằng `-`).
 * Trả repo đã mở (repo do app clone được tin sẵn).
 */
export async function cloneRepoInfo(
  url: string,
  destination: string,
  options: CloneOptions = {},
): Promise<OpenedRepo> {
  const { token, name } = splitDestination(destination);
  const opId = newOpId();
  const decoder = new TextDecoder();
  const progress = new FrameCollector((line) => options.onProgress?.(decoder.decode(line)));
  const channel = new Channel<RawFrame>((frame) => {
    try {
      progress.push(frame);
    } catch {
      // Frame lỗi không làm hỏng clone: kết quả lấy từ giá trị trả về của lệnh.
    }
  });
  const signal = options.signal;
  if (signal?.aborted) throw abortError();
  let finished = false;
  const onAbort = (): void => {
    void (async () => {
      for (let attempt = 0; attempt < 20 && !finished; attempt++) {
        try {
          if (await call<boolean>(Commands.gitCancel, { opId })) return;
        } catch {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    })();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await call<OpenedRepo>(Commands.gitClone, { url, destToken: token, name, opId, channel });
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw toCommandFailure(error);
  } finally {
    finished = true;
    signal?.removeEventListener('abort', onAbort);
  }
}

/** `git init` (nhánh `main` nếu người dùng chưa đặt `init.defaultBranch`); trả repo đã mở (tin sẵn). */
export function initRepoInfo(destination: string): Promise<OpenedRepo> {
  const { token, name } = splitDestination(destination);
  return call<OpenedRepo>(Commands.gitInit, { destToken: token, name });
}

// --- lệnh git có kiểu (không đi qua `git_exec`) -------------------------------------------------------------------------

export function configSet(repoId: string, key: string, value: string, scope: ConfigScope): Promise<void> {
  return call<void>(Commands.gitConfigSet, { repoId, key, value, scope });
}

export function remoteAdd(repoId: string, name: string, url: string): Promise<void> {
  return call<void>(Commands.gitRemoteAdd, { repoId, name, url });
}

export function remoteSetUrl(repoId: string, name: string, url: string): Promise<void> {
  return call<void>(Commands.gitRemoteSetUrl, { repoId, name, url });
}

/** Rebase tương tác theo kế hoạch có cấu trúc — Rust kiểm từng mục và tự soạn file todo. */
export function rebaseInteractive(
  repoId: string,
  onto: string,
  steps: readonly RebaseStepRequest[],
): Promise<RebaseResult> {
  return call<RebaseResult>(Commands.gitRebaseInteractive, { repoId, onto, steps });
}
