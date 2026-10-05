// Packages a diff into the context sent to the AI (`AiDiffContext` from contracts). Whatever is dropped here NEVER
// leaves the machine:
//  - whole files: by name (lockfile / generated / sensitive), binary, or not UTF-8;
//  - individual hunks: containing a secret-looking string (secret-scan.ts) → drop the hunk, record it in `redactions`;
//  - over the token budget: per-file cap PER_FILE_TOKENS preferring hunks with the most changed lines; once the shared
//    budget is gone, send file names only.

import type { AiDiffFile, AiFileStatus, AiSkippedFile } from '@thaigit/contracts';
import type { DiffHunk, FileDiff } from '../diff/diff.ts';
import { decodeUtf8Strict } from '../support/text.ts';
import { classifyPath, findSecret } from './secret-scan.ts';
import { estimateTokens } from './token-estimate.ts';

/** Token cap for one file, so a single huge file cannot swallow the whole budget. */
export const PER_FILE_TOKENS = 2000;
/** Files smaller than this are sent by name only (a few stray lines would not help the model). */
const MIN_FILE_TOKENS = 60;

export interface Redaction {
  path: string;
  rule: string;
}

export interface BuiltContext {
  files: AiDiffFile[];
  skipped: AiSkippedFile[];
  /** Hunks dropped as suspected secrets (so the UI can report "Dropped N possible secrets"). */
  redactions: Redaction[];
  /** Token estimate of the diff portion actually sent. */
  tokens: number;
}

interface Candidate {
  path: string;
  oldPath?: string;
  status: AiFileStatus;
  additions: number;
  deletions: number;
  /** Decoded, secret-scanned hunks, in file order. */
  hunks: { text: string; tokens: number; changes: number }[];
  /** Whether any hunk was dropped as a suspected secret. */
  redacted: boolean;
}

function filePath(file: FileDiff): string {
  return file.newPath ?? file.oldPath ?? '';
}

function fileStatus(file: FileDiff): AiFileStatus {
  if (file.isNewFile) return 'added';
  if (file.isDeletedFile) return 'deleted';
  if (file.oldPath !== null && file.newPath !== null && file.oldPath !== file.newPath) return 'renamed';
  if (
    file.hunks.length === 0 &&
    file.oldMode !== null &&
    file.newMode !== null &&
    file.oldMode !== file.newMode
  ) {
    return 'typechange';
  }
  return 'modified';
}

const PREFIX = { context: ' ', addition: '+', deletion: '-', noNewline: '\\ ' } as const;

/** Hunk → unified text; `null` when a line is not UTF-8. Trailing "\r" is dropped (useless to the model, costly in tokens). */
function hunkText(hunk: DiffHunk): string | null {
  const lines = [hunk.header];
  for (const line of hunk.lines) {
    const text = decodeUtf8Strict(line.text);
    if (text === null) return null;
    lines.push(PREFIX[line.kind] + text.replace(/\r$/, ''));
  }
  return `${lines.join('\n')}\n`;
}

function candidateFor(file: FileDiff, skipped: AiSkippedFile[], redactions: Redaction[]): Candidate | null {
  const path = filePath(file);
  const base = { path, additions: file.additions, deletions: file.deletions };
  const byName = classifyPath(path) ?? (file.oldPath !== null ? classifyPath(file.oldPath) : null);
  if (byName !== null) {
    skipped.push({ ...base, reason: byName });
    return null;
  }
  if (file.isBinary) {
    skipped.push({ ...base, reason: 'binary' });
    return null;
  }
  const hunks: Candidate['hunks'] = [];
  let redacted = false;
  for (const hunk of file.hunks) {
    const text = hunkText(hunk);
    if (text === null) {
      skipped.push({ ...base, reason: 'undecodable' });
      return null;
    }
    const rule = findSecret(text);
    if (rule !== null) {
      redacted = true;
      redactions.push({ path, rule });
      continue;
    }
    const changes = hunk.lines.filter((line) => line.kind === 'addition' || line.kind === 'deletion').length;
    hunks.push({ text, tokens: estimateTokens(text), changes });
  }
  if (redacted && hunks.length === 0) {
    skipped.push({ ...base, reason: 'secret' });
    return null;
  }
  const status = fileStatus(file);
  return {
    ...base,
    ...(status === 'renamed' && file.oldPath !== null ? { oldPath: file.oldPath } : {}),
    status,
    hunks,
    redacted,
  };
}

/** Pick hunks within `budget`: prefer hunks changing the most lines, but keep original order when assembling. */
function pickHunks(
  candidate: Candidate,
  budget: number,
): { patch: string; tokens: number; truncated: boolean } {
  const order = candidate.hunks
    .map((hunk, index) => ({ hunk, index }))
    .sort((a, b) => b.hunk.changes - a.hunk.changes || a.index - b.index);
  const chosen = new Set<number>();
  let tokens = 0;
  for (const { hunk, index } of order) {
    if (tokens + hunk.tokens > budget) continue;
    chosen.add(index);
    tokens += hunk.tokens;
  }
  const patch = candidate.hunks
    .filter((_, index) => chosen.has(index))
    .map((hunk) => hunk.text)
    .join('');
  return { patch, tokens, truncated: chosen.size < candidate.hunks.length };
}

/**
 * `diffs`: `parseDiff` output for all changes (e.g. `git diff --cached`). `budgetTokens`: the part of the budget spent on
 * the diff (prompt, subjects… already deducted). Small files are considered first so the rest is shared evenly among
 * large ones.
 */
export function buildDiffContext(diffs: readonly FileDiff[], budgetTokens: number): BuiltContext {
  const skipped: AiSkippedFile[] = [];
  const redactions: Redaction[] = [];
  const candidates: Candidate[] = [];
  for (const file of diffs) {
    const candidate = candidateFor(file, skipped, redactions);
    if (candidate !== null) candidates.push(candidate);
  }

  const totalOf = (candidate: Candidate) => candidate.hunks.reduce((sum, hunk) => sum + hunk.tokens, 0);
  const bySize = candidates.map((candidate, index) => ({ candidate, index, total: totalOf(candidate) }));
  bySize.sort((a, b) => a.total - b.total || a.index - b.index);

  const results = new Map<number, AiDiffFile>();
  let remaining = Math.max(0, budgetTokens);
  let tokens = 0;
  bySize.forEach(({ candidate, index, total }, position) => {
    const share = Math.floor(remaining / (bySize.length - position));
    const allowance = Math.min(PER_FILE_TOKENS, share, total);
    const picked = pickHunks(candidate, allowance);
    const nothingFits = candidate.hunks.length > 0 && picked.patch === '';
    if (nothingFits || (total > 0 && allowance < MIN_FILE_TOKENS && allowance < total)) {
      skipped.push({
        path: candidate.path,
        reason: 'budget',
        additions: candidate.additions,
        deletions: candidate.deletions,
      });
      return;
    }
    remaining -= picked.tokens;
    tokens += picked.tokens;
    results.set(index, {
      path: candidate.path,
      ...(candidate.oldPath !== undefined ? { oldPath: candidate.oldPath } : {}),
      status: candidate.status,
      additions: candidate.additions,
      deletions: candidate.deletions,
      truncated: picked.truncated || candidate.redacted,
      patch: picked.patch,
    });
  });

  const files = candidates.flatMap((_, index) => {
    const file = results.get(index);
    return file === undefined ? [] : [file];
  });
  return { files, skipped, redactions, tokens };
}
