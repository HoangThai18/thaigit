// The server trims further when the context exceeds `AI_MAX_INPUT_TOKENS` (an older app, or the app-side estimate being
// off): the largest files lose their content first (name only). The estimation matches the app
// (`packages/core/src/ai/token-estimate.ts`).

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
 * Returns a context trimmed to the budget, or `null` when even dropping all content does not fit (`too_large`). `measure`
 * counts the tokens of the whole prompt built from the context.
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
