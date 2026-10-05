import { Channel } from '@tauri-apps/api/core';
import { Commands, type OpenedRepo, type RebaseResult, type RebaseStepRequest } from '@thaigit/contracts';
import { toCommandFailure } from './errors.ts';
import { FrameCollector, type RawFrame, newOpId } from './gitExec.ts';
import { call } from './invoke.ts';
import type { ConfigScope } from './types.ts';

/** On Tauri a `GitHost` `destination` is the folder token returned by the native dialog, optionally with a subfolder name: `token` or `token/name`. */
export function splitDestination(destination: string): { token: string; name: string | null } {
  const slash = destination.indexOf('/');
  if (slash < 0) return { token: destination, name: null };
  const name = destination.slice(slash + 1);
  return { token: destination.slice(0, slash), name: name === '' ? null : name };
}

export interface CloneOptions {
  /** One line of git progress ("Receiving objects: 45% …"). */
  onProgress?: (line: string) => void;
  /** Cancel the clone (soft → hard escalation; the partial directory is cleaned up). */
  signal?: AbortSignal;
}

function abortError(): Error {
  const error = new Error('Đã huỷ clone');
  error.name = 'AbortError';
  return error;
}

/**
 * Clone into a directory picked by the native dialog (Rust validates the URL: no `ext::`, no `fd::`,
 * not starting with `-`). Returns the opened repo (a repo cloned by the app is trusted by definition).
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
      // An error frame must not fail the clone: the result comes from the command's return value.
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

/** `git init` (branch `main` when the user has not set `init.defaultBranch`); returns the opened repo (trusted). */
export function initRepoInfo(destination: string): Promise<OpenedRepo> {
  const { token, name } = splitDestination(destination);
  return call<OpenedRepo>(Commands.gitInit, { destToken: token, name });
}

// --- typed git commands (not going through `git_exec`) ------------------------------------------------------

export function configSet(repoId: string, key: string, value: string, scope: ConfigScope): Promise<void> {
  return call<void>(Commands.gitConfigSet, { repoId, key, value, scope });
}

export function remoteAdd(repoId: string, name: string, url: string): Promise<void> {
  return call<void>(Commands.gitRemoteAdd, { repoId, name, url });
}

export function remoteSetUrl(repoId: string, name: string, url: string): Promise<void> {
  return call<void>(Commands.gitRemoteSetUrl, { repoId, name, url });
}

/** Add a worktree in a directory picked by the native dialog (`destToken`); returns the new worktree path. */
export function worktreeAdd(
  repoId: string,
  destToken: string,
  name: string,
  branch: string,
  createBranch: boolean,
  start: string | null,
): Promise<string> {
  return call<string>(Commands.gitWorktreeAdd, { repoId, destToken, name, branch, createBranch, start });
}

/** Open one of the repo's worktrees / submodules in a new window — Rust checks that git really tracks that path. */
export function openRelatedRepo(repoId: string, kind: 'worktree' | 'submodule', path: string): Promise<void> {
  return call<void>(Commands.openRelatedRepo, { repoId, kind, path });
}

/** Interactive rebase from a structured plan — Rust validates every entry and assembles the todo file itself. */
export function rebaseInteractive(
  repoId: string,
  onto: string,
  steps: readonly RebaseStepRequest[],
): Promise<RebaseResult> {
  return call<RebaseResult>(Commands.gitRebaseInteractive, { repoId, onto, steps });
}
