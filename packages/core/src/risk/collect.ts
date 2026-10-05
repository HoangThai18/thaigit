// Gathers the inputs for pre-commit risk flags from uncommitted changes: one `git diff HEAD -U0` (added lines only) for
// tracked files, plus reading new files (untracked or newly staged) for their size and content. Capped so a huge WIP
// cannot slow the UI: past the cap only paths are examined.

import { decodeUtf8 } from '../git/bytes.ts';
import { headOid, type FileChange, type WorkingTreeStatus } from '../git/models.ts';
import { unquoteGitPath } from '../git/parsers.ts';
import type { GitRepository } from '../git/repository.ts';
import { LARGE_FILE_BYTES, type RiskInput } from './risk-flags.ts';

/** Beyond this many bytes of diff output, drop the content. */
const MAX_DIFF_BYTES = 8 * 1024 * 1024;
/** Maximum number of new files read. */
const MAX_NEW_FILES = 100;

function statusOf(change: FileChange): RiskInput['status'] {
  if (change.kind === 'deleted') return 'deleted';
  if (change.kind === 'added' || change.kind === 'untracked') return 'added';
  return 'modified';
}

/** `git diff -U0` → added lines keyed by the new path. */
export function addedLinesByPath(patch: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  let current: string | null = null;
  let inHeader = false;
  let oldPath: string | null = null;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = null;
      oldPath = null;
      inHeader = true;
      continue;
    }
    if (inHeader) {
      if (line.startsWith('--- ')) {
        const raw = line.slice(4);
        oldPath = raw === '/dev/null' ? null : unquoteGitPath(raw).replace(/^a\//, '');
      } else if (line.startsWith('+++ ')) {
        const raw = line.slice(4);
        current = raw === '/dev/null' ? oldPath : unquoteGitPath(raw).replace(/^b\//, '');
      } else if (line.startsWith('@@')) {
        inHeader = false;
      }
      continue;
    }
    if (current !== null && line.startsWith('+')) {
      const list = result.get(current) ?? [];
      list.push(line.slice(1).replace(/\r$/, ''));
      result.set(current, list);
    }
  }
  return result;
}

export async function collectRiskInputs(
  repo: GitRepository,
  status: WorkingTreeStatus,
): Promise<RiskInput[]> {
  const files = new Map<string, { status: RiskInput['status']; addedLines: string[]; size: number | null }>();
  // The working tree is what "Stage all & commit" will commit: unstaged changes override already-staged ones.
  for (const change of [...status.staged, ...status.unstaged]) {
    files.set(change.path, { status: statusOf(change), addedLines: [], size: null });
  }
  if (files.size === 0) return [];

  if (headOid(status.head) !== null) {
    const out = await repo.runner.run('diff', ['HEAD', '-U0', '--no-color', '--no-renames']);
    if (out.stdout.length <= MAX_DIFF_BYTES) {
      for (const [path, lines] of addedLinesByPath(decodeUtf8(out.stdout))) {
        const entry = files.get(path);
        if (entry) entry.addedLines = lines;
      }
    }
  }

  // New files: the size, and the content when `diff HEAD` has none (untracked, or the repo has no commits yet).
  const fresh = [...files].filter(([, entry]) => entry.status === 'added').slice(0, MAX_NEW_FILES);
  for (const [path, entry] of fresh) {
    let bytes: Uint8Array | null;
    try {
      bytes = await repo.fs.readWorktreeFile(path, LARGE_FILE_BYTES + 1);
    } catch {
      // No API to measure the size: a read rejected with LARGE_FILE_BYTES + 1 means the file exceeds the cap.
      entry.size = LARGE_FILE_BYTES + 1;
      continue;
    }
    if (bytes === null) continue;
    entry.size = bytes.length;
    if (entry.addedLines.length === 0 && !bytes.includes(0)) {
      entry.addedLines = decodeUtf8(bytes)
        .split('\n')
        .map((line) => line.replace(/\r$/, ''));
    }
  }
  return [...files].map(([path, entry]) => ({ path, ...entry }));
}
