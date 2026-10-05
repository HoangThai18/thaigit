// Image diff: fetch the old / new bytes of an image file from whichever diff source it came from (index,
// HEAD, a commit, a stash, the working tree) so the two can be viewed side by side. Read-only (cat-file /
// file read) and size-capped.

import type { FileChange, GitRepository, Stash } from '@thaigit/core';
import type { DiffSource } from '../stores/diff.svelte.ts';

/** Image formats both WKWebView and WebView2 can display. */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
};

/** Above this size there is no preview (avoids holding tens of MB in webview memory). */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export function imageType(path: string): string | null {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return null;
  return IMAGE_TYPES[path.slice(dot + 1).toLowerCase()] ?? null;
}

export type ImageSide =
  | { readonly kind: 'none' }
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
  | { readonly kind: 'tooLarge' }
  | { readonly kind: 'failed' };

export interface ImagePair {
  readonly old: ImageSide;
  readonly new: ImageSide;
}

async function read(load: () => Promise<Uint8Array | null>): Promise<ImageSide> {
  try {
    const bytes = await load();
    if (bytes === null) return { kind: 'none' };
    if (bytes.length > MAX_IMAGE_BYTES) return { kind: 'tooLarge' };
    return { kind: 'bytes', bytes };
  } catch {
    return { kind: 'failed' };
  }
}

/** Both sides' bytes of the image file `change` per `source`. A new file has no old side; a deleted file has no new side. */
export async function loadImagePair(
  git: GitRepository,
  source: DiffSource,
  change: FileChange,
  context: { headOid: string | null; stashes: readonly Stash[] },
): Promise<ImagePair> {
  const path = change.path;
  const oldPath = change.oldPath ?? path;
  const isNew = change.kind === 'added' || change.kind === 'untracked';
  const isGone = change.kind === 'deleted';
  const none = async () => null;
  let oldLoad: () => Promise<Uint8Array | null> = none;
  let newLoad: () => Promise<Uint8Array | null> = none;
  switch (source.kind) {
    case 'unstaged':
      if (change.kind !== 'untracked') oldLoad = () => git.blob(`:${oldPath}`);
      newLoad = () => git.readWorkingFile(path, MAX_IMAGE_BYTES + 1);
      break;
    case 'staged':
      if (context.headOid !== null) oldLoad = () => git.blob(`HEAD:${oldPath}`);
      newLoad = () => git.blob(`:${path}`);
      break;
    case 'commit':
      if (source.parent !== null) oldLoad = () => git.blob(`${source.parent}:${oldPath}`);
      newLoad = () => git.blob(`${source.sha}:${path}`);
      break;
    case 'stash':
      oldLoad = () => git.blob(`${source.sha}^1:${oldPath}`);
      newLoad = () => git.blob(`${source.sha}:${path}`);
      break;
    case 'conflict':
      break;
  }
  const [oldSide, newSide] = await Promise.all([
    isNew ? Promise.resolve<ImageSide>({ kind: 'none' }) : read(oldLoad),
    isGone ? Promise.resolve<ImageSide>({ kind: 'none' }) : read(newLoad),
  ]);
  return { old: oldSide, new: newSide };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
