// Gọi Hermes qua API kiểu OpenAI (`/chat/completions`, `stream: true`) — Ollama, llama.cpp server, vLLM, Hermes Agent
// API server… đều nói chuẩn này. Không tự thử lại (thử lại làm gấp đôi tải lên máy đang nghẽn).

import type { AiUsage } from '@thaigit/contracts';
import type { Config } from '../env.ts';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export type UpstreamChunk = { type: 'text'; text: string } | { type: 'usage'; usage: AiUsage };

export class UpstreamError extends Error {
  readonly kind: 'unavailable' | 'timeout' | 'cancelled';

  constructor(kind: 'unavailable' | 'timeout' | 'cancelled') {
    super(kind);
    this.kind = kind;
  }
}

type Fetch = typeof fetch;

function headers(config: Config['hermes']): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    ...(config.apiKey !== null ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  };
}

/** Tách luồng SSE kiểu OpenAI (chỉ cần "data:"; frame "[DONE]" kết thúc). */
async function* dataLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r\n|\n|\r/);
      buffer = done ? '' : (lines.pop() ?? '');
      for (const line of lines) {
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

/**
 * Stream một completion. `signal` huỷ từ phía app (người dùng bấm Huỷ / mất kết nối); timeout tổng do cấu hình.
 * Lỗi mạng / HTTP / định dạng → `UpstreamError('unavailable')`.
 */
export async function* streamChat(
  config: Config['hermes'],
  messages: ChatMessage[],
  maxTokens: number,
  signal: AbortSignal,
  fetchImpl: Fetch = fetch,
): AsyncGenerator<UpstreamChunk> {
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const combined = AbortSignal.any([signal, timeout]);
  const reason = () => (signal.aborted ? 'cancelled' : timeout.aborted ? 'timeout' : 'unavailable');
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.3,
        max_tokens: maxTokens,
      }),
      signal: combined,
    });
  } catch {
    throw new UpstreamError(reason());
  }
  if (!response.ok || response.body === null) {
    await response.body?.cancel().catch(() => {});
    throw new UpstreamError('unavailable');
  }
  try {
    for await (const data of dataLines(response.body)) {
      if (data === '[DONE]') return;
      let payload: unknown;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }
      if (typeof payload !== 'object' || payload === null) continue;
      const record = payload as {
        choices?: { delta?: { content?: unknown } }[];
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } | null;
        error?: unknown;
      };
      if (record.error !== undefined) throw new UpstreamError('unavailable');
      const content = record.choices?.[0]?.delta?.content;
      if (typeof content === 'string' && content !== '') yield { type: 'text', text: content };
      if (record.usage) {
        yield {
          type: 'usage',
          usage: {
            promptTokens: asCount(record.usage.prompt_tokens),
            completionTokens: asCount(record.usage.completion_tokens),
          },
        };
      }
    }
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    throw new UpstreamError(reason());
  }
}

/** Kiểm model còn chạy: `GET /models` trả 200 và có đúng model đã cấu hình (hoặc server chỉ phục vụ một model). */
export async function checkModel(config: Config['hermes'], fetchImpl: Fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(`${config.baseUrl}/models`, {
      headers: headers(config),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { data?: { id?: unknown }[] };
    const ids = (body.data ?? []).map((item) => item.id).filter((id): id is string => typeof id === 'string');
    if (ids.length <= 1) return true;
    return ids.some((id) => id === config.model || id.split(':')[0] === config.model.split(':')[0]);
  } catch {
    return false;
  }
}
