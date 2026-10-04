// Bản Node (test) của phần soạn todo trong `apps/desktop/src-tauri/src/rebase.rs` — giữ đúng cùng luật: sha đầy đủ, không
// trùng, message đi qua file (không bao giờ nằm trong todo), sequence editor chỉ dùng lệnh dựng sẵn của shell.

import type { RebaseStepRequest } from '@thaigit/contracts';
import { AdapterError } from '../git/runner.ts';

const OBJECT_ID = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const MAX_STEPS = 2000;
const MAX_MESSAGE = 64 * 1024;

function reject(detail: string): never {
  throw new AdapterError('policy', `Kế hoạch rebase bị chặn: ${detail}`);
}

export function validateRebasePlan(onto: string, steps: readonly RebaseStepRequest[]): void {
  if (!OBJECT_ID.test(onto)) reject('`onto` phải là sha đầy đủ');
  if (steps.length === 0 || steps.length > MAX_STEPS) reject(`phải có 1–${MAX_STEPS} commit`);
  const seen = new Set<string>();
  for (const step of steps) {
    if (!OBJECT_ID.test(step.sha)) reject('sha không hợp lệ');
    const sha = step.sha.toLowerCase();
    if (seen.has(sha)) reject('một commit xuất hiện hai lần');
    seen.add(sha);
    if (step.action === 'reword') {
      const message = step.message ?? '';
      if (
        message.trim() === '' ||
        new TextEncoder().encode(message).length > MAX_MESSAGE ||
        message.includes('\0')
      )
        reject('message mới rỗng, quá dài hoặc chứa NUL');
    }
  }
  const firstKept = steps.find((step) => step.action !== 'drop');
  if (firstKept && (firstKept.action === 'squash' || firstKept.action === 'fixup'))
    reject('commit cũ nhất còn lại không gộp được');
}

export function shQuote(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

export function buildRebaseTodo(
  steps: readonly RebaseStepRequest[],
  messageFile: (index: number) => string,
): string {
  const lines: string[] = [];
  steps.forEach((step, index) => {
    const sha = step.sha.toLowerCase();
    if (step.action === 'reword') {
      lines.push(`pick ${sha}`);
      lines.push(
        `exec git commit --amend --only --no-verify --allow-empty --cleanup=whitespace -F ${shQuote(messageFile(index))}`,
      );
    } else {
      lines.push(`${step.action} ${sha}`);
    }
  });
  return `${lines.join('\n')}\n`;
}

export function sequenceEditor(todoPath: string): string {
  return `while IFS= read -r line; do printf '%s\\n' "$line"; done < ${shQuote(todoPath)} >`;
}
