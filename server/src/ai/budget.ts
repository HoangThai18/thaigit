// Máy chủ tự cắt thêm khi ngữ cảnh vượt `AI_MAX_INPUT_TOKENS` (app cũ hoặc ước lượng phía app lệch): bỏ nội dung các
// file lớn nhất trước (chỉ còn tên). Cách ước lượng giống app (`packages/core/src/ai/token-estimate.ts`).

import type { AiDiffContext } from '@thaigit/contracts';
import type { ChatMessage } from './upstream.ts';

export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) < 128) ascii += 1;
    else other += 1;
  }
  return Math.ceil(ascii / 3.5 + other / 1.2);
}

export function messagesTokens(messages: readonly ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(message.content) + 4, 0);
}

/**
 * Trả bản ngữ cảnh vừa ngân sách (hoặc `null` nếu bỏ hết nội dung vẫn không vừa → `too_large`). `measure` tính token
 * của toàn bộ prompt dựng từ ngữ cảnh.
 */
export function fitContext<T extends AiDiffContext>(
  request: T,
  maxTokens: number,
  measure: (request: T) => number,
): T | null {
  let current = request;
  if (measure(current) <= maxTokens) return current;
  const order = [...current.files].sort((a, b) => b.patch.length - a.patch.length);
  for (const victim of order) {
    current = {
      ...current,
      files: current.files.filter((file) => file !== victim),
      skipped: [
        ...current.skipped,
        { path: victim.path, reason: 'budget', additions: victim.additions, deletions: victim.deletions },
      ],
    };
    if (measure(current) <= maxTokens) return current;
  }
  return null;
}
