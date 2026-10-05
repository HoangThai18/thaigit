// Builds the request body sent to the AI from the open repo: the diff (filtered and secret-scanned by the
// core's `buildDiffContext`), the branches and a few recent subjects. The exact same data backs "See the data
// so what the user sees is what actually goes out.

import {
  AI_LIMITS,
  type CommitMessageRequest,
  type ExplainCommitRequest,
  type PrDescriptionRequest,
} from '@thaigit/contracts';
import { buildDiffContext, parseDiff, type Commit, type GitRepository } from '@thaigit/core';
import type { AiPreview, AiStore } from '../stores/ai.svelte.ts';

/** Share of the token budget reserved for prompt + subjects + answer (the rest goes to the diff). */
const PROMPT_RESERVE = 900;

function diffBudget(ai: AiStore): number {
  const max = ai.quota?.maxInputTokens ?? AI_LIMITS.defaultMaxInputTokens;
  return Math.max(500, max - PROMPT_RESERVE);
}

const clip = (subjects: readonly string[], limit: number) =>
  subjects.slice(0, limit).map((subject) => [...subject].slice(0, AI_LIMITS.maxSubjectLength).join(''));

export interface Prepared<T> {
  request: T;
  preview: AiPreview;
}

/** Commit-writing context: staged changes (when amending with nothing staged, use the diff of the commit being amended). `null` = nothing to send. */
export async function commitContext(
  git: GitRepository,
  ai: AiStore,
  head: { branch: string | null; oid: string | null; amend: boolean },
): Promise<Prepared<CommitMessageRequest> | null> {
  let bytes = await git.stagedDiffBytes();
  if (bytes.length === 0 && head.amend && head.oid !== null) {
    const parent = await git.resolveCommit(`${head.oid}^`).catch(() => null);
    bytes = await git.commitPatchBytes(head.oid, parent);
  }
  const built = buildDiffContext(parseDiff(bytes), diffBudget(ai));
  if (built.files.length === 0 && built.skipped.length === 0) return null;
  const subjects =
    head.oid === null ? [] : clip(await git.recentSubjects(AI_LIMITS.maxSubjects).catch(() => []), 10);
  const request: CommitMessageRequest = {
    files: built.files,
    skipped: built.skipped,
    branch: head.branch === null ? null : head.branch.slice(0, AI_LIMITS.maxBranchLength),
    recentSubjects: subjects,
    options: { ...ai.saved.options },
  };
  return {
    request,
    preview: {
      feature: 'commit',
      branch: request.branch,
      files: built.files,
      skipped: built.skipped,
      redactions: built.redactions.length,
      subjects,
    },
  };
}

/** Context for explaining one commit (compared against its first parent). */
export async function explainContext(
  git: GitRepository,
  ai: AiStore,
  commit: Commit,
): Promise<Prepared<ExplainCommitRequest> | null> {
  const parent = commit.parents[0] ?? null;
  const [bytes, message] = await Promise.all([
    git.commitPatchBytes(commit.id, parent),
    git.commitMessage(commit.id),
  ]);
  const built = buildDiffContext(parseDiff(bytes), diffBudget(ai));
  if (built.files.length === 0 && built.skipped.length === 0) return null;
  const request: ExplainCommitRequest = {
    files: built.files,
    skipped: built.skipped,
    message: [...message.trim()].slice(0, AI_LIMITS.maxMessageLength).join(''),
    language: ai.saved.options.language,
  };
  return {
    request,
    preview: {
      feature: 'explain',
      branch: null,
      files: built.files,
      skipped: built.skipped,
      redactions: built.redactions.length,
      subjects: [],
    },
  };
}

/** Context for a Pull Request description: commits + diff of `head` against its fork point from `base`. */
export async function prContext(
  git: GitRepository,
  ai: AiStore,
  base: string,
  head: string,
): Promise<Prepared<PrDescriptionRequest> | null> {
  const [bytes, commits] = await Promise.all([
    git.branchDiffBytes(base, head),
    git.recentSubjects(AI_LIMITS.maxCommits, head, base),
  ]);
  const built = buildDiffContext(parseDiff(bytes), diffBudget(ai));
  if (built.files.length === 0 && built.skipped.length === 0) return null;
  const subjects = clip(commits, AI_LIMITS.maxCommits);
  const request: PrDescriptionRequest = {
    files: built.files,
    skipped: built.skipped,
    base: base.slice(0, AI_LIMITS.maxBranchLength),
    head: head.slice(0, AI_LIMITS.maxBranchLength),
    commits: subjects,
    language: ai.saved.options.language,
  };
  return {
    request,
    preview: {
      feature: 'pr',
      branch: head,
      files: built.files,
      skipped: built.skipped,
      redactions: built.redactions.length,
      subjects,
    },
  };
}
