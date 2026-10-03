import { Commands } from '@thaigit/contracts';
import type { RepoFs } from '@thaigit/core';
import { isCommandFailure } from './errors.ts';
import { call } from './invoke.ts';

async function readOrNull(command: string, args: Record<string, unknown>): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await call<ArrayBuffer>(command, args));
  } catch (error) {
    if (isCommandFailure(error, 'not-found')) return null;
    throw error;
  }
}

/**
 * RepoFs của một repo đã mở: đọc/ghi theo BYTE trong phạm vi repo (Rust kiểm realpath, từ chối `..`, đường dẫn tuyệt đối,
 * symlink ra ngoài và mọi đoạn `.git`). Ghi gửi byte thô (không JSON) qua thân yêu cầu; tham số nằm ở header.
 */
export function createRepoFs(repoId: string): RepoFs {
  return {
    readGitFile: (relative) => readOrNull(Commands.fsReadGitFile, { repoId, rel: relative }),

    readWorktreeFile: (relative, maxBytes) =>
      readOrNull(Commands.fsReadWorktreeFile, { repoId, rel: relative, maxBytes: maxBytes ?? null }),

    async writeWorktreeFile(relative, bytes, expectedSha256) {
      await call<void>(Commands.fsWriteWorktreeFile, bytes, {
        headers: {
          'x-repo-id': repoId,
          'x-rel': encodeURIComponent(relative),
          'x-expected-sha256': expectedSha256 ?? '',
        },
      });
    },

    async appendGitignore(line) {
      await call<void>(Commands.fsAppendGitignore, { repoId, line });
    },

    trashUntracked: (relatives) => call<string>(Commands.fsTrashUntracked, { repoId, rels: [...relatives] }),

    async restoreTrash(token) {
      await call<void>(Commands.fsRestoreTrash, { repoId, token });
    },

    prepareSnapshotIndex: (reset) => call<string>(Commands.fsSnapshotIndexPrepare, { repoId, reset }),
  };
}
