// Post-processes the text the AI returned. The server cannot fix text it already streamed, so the app cleans up after
// the `done` frame: strip <think>…</think> blocks (Hermes 4 is a hybrid reasoning model), strip code fences, drop stray
// labels ("Commit message:") and surrounding quotes, and split the summary (≤ 72 chars) from the description.

import { codePointLength } from '../support/text.ts';

export const SUMMARY_LIMIT = 72;

/** Strip closed <think> blocks and a still-open one (while the stream has not reached </think>). */
export function stripThinking(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const open = out.search(/<think>/i);
  if (open !== -1) out = out.slice(0, open);
  return out;
}

/** Strip one wrapping ``` fence (possibly with a language tag), keeping the inside. */
function stripOuterFence(text: string): string {
  const match = /^\s*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?\1\s*$/.exec(text);
  if (match?.[2] !== undefined) return match[2];
  // Fence opened but never closed (the model stopped mid-stream).
  const open = /^\s*(`{3,}|~{3,})[^\n]*\n/.exec(text);
  return open === null ? text : text.slice(open[0].length);
}

const LABEL = /^(?:\*\*)?(?:commit message|message|tóm tắt|summary|subject|tiêu đề|commit)(?:\*\*)?\s*:\s*/i;

function cleanSummary(line: string): string {
  let text = line.trim().replace(LABEL, '');
  text = text.replace(/^#{1,6}\s+/, '').replace(/^[-*•]\s+/, '');
  text = text.replace(/^\*\*(.+)\*\*$/, '$1');
  const quoted = /^(["'`“])(.*)(["'`”])$/.exec(text);
  if (quoted?.[2] !== undefined) text = quoted[2];
  return text.replace(/\.$/, '').trim();
}

/** Cut at the nearest word boundary ≤ `limit` chars; returns [head, rest]. */
function splitAtWord(text: string, limit: number): [string, string] {
  if (codePointLength(text) <= limit) return [text, ''];
  const chars = [...text];
  const head = chars.slice(0, limit + 1).join('');
  const space = head.lastIndexOf(' ');
  if (space < limit / 2)
    return [chars.slice(0, limit).join('').trimEnd(), chars.slice(limit).join('').trim()];
  return [text.slice(0, space).trimEnd(), text.slice(space + 1).trim()];
}

export interface CommitMessageParts {
  summary: string;
  body: string;
}

export function finalizeCommitMessage(raw: string): CommitMessageParts {
  const text = stripOuterFence(stripThinking(raw).trim()).replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const first = lines.findIndex((line) => line.trim() !== '');
  if (first === -1) return { summary: '', body: '' };
  const [summary, overflow] = splitAtWord(cleanSummary(lines[first] ?? ''), SUMMARY_LIMIT);
  const rest = lines
    .slice(first + 1)
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(LABEL, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const body = [overflow, rest].filter((part) => part !== '').join('\n\n');
  return { summary, body };
}

/** Markdown (commit explanations, PR descriptions): strip <think> and a wrapping fence, keep everything else. */
export function finalizeMarkdown(raw: string): string {
  return stripOuterFence(stripThinking(raw).trim()).replace(/\r\n?/g, '\n').trim();
}
