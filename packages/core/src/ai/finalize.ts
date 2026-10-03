// Hoàn thiện chữ AI trả về. Máy chủ không sửa được chữ đã stream, nên app dọn lại sau frame `done`: bỏ khối suy nghĩ
// <think>…</think> (Hermes 4 là model lai có lập luận), bỏ code fence, nhãn thừa ("Commit message:"), dấu nháy bao
// ngoài; tách tóm tắt (≤ 72 ký tự) và mô tả.

import { codePointLength } from '../support/text.ts';

export const SUMMARY_LIMIT = 72;

/** Bỏ khối <think> đã đóng, và cả khối đang mở dở (lúc stream chưa tới </think>). */
export function stripThinking(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const open = out.search(/<think>/i);
  if (open !== -1) out = out.slice(0, open);
  return out;
}

/** Bỏ một khối ``` bao ngoài (có thể kèm tên ngôn ngữ), giữ phần bên trong. */
function stripOuterFence(text: string): string {
  const match = /^\s*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?\1\s*$/.exec(text);
  if (match?.[2] !== undefined) return match[2];
  // Fence mở mà không đóng (model dừng giữa chừng).
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

/** Cắt ở ranh giới từ gần nhất ≤ `limit` ký tự; trả [phần đầu, phần dư]. */
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

/** Markdown (giải thích commit, mô tả PR): bỏ <think> và fence bao ngoài, giữ nguyên phần còn lại. */
export function finalizeMarkdown(raw: string): string {
  return stripOuterFence(stripThinking(raw).trim()).replace(/\r\n?/g, '\n').trim();
}
