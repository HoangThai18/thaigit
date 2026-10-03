// Đọc luồng Server-Sent Events theo chuẩn WHATWG (đủ cho máy chủ Thaigit lẫn API kiểu OpenAI): dòng tách bởi CRLF/LF/CR,
// "event:" đặt tên, nhiều "data:" nối bằng "\n", dòng trống phát frame, dòng ":" là chú thích. Chunk mạng có thể cắt
// ngang dòng (hoặc ngang cặp CRLF) — parser giữ phần dở cho lần sau.

import { parseAiFrame, type AiFrame } from '@thaigit/contracts';

export interface SseEvent {
  event: string;
  data: string;
}

export class SseParser {
  #buffer = '';
  #event = '';
  #data: string[] = [];
  #pendingCR = false;

  /** Thêm một đoạn chữ, trả các frame đã đủ. */
  push(chunk: string): SseEvent[] {
    let text = chunk;
    // "\r" ở cuối chunk trước + "\n" ở đầu chunk này là MỘT ký tự xuống dòng.
    if (this.#pendingCR && text.startsWith('\n')) text = text.slice(1);
    this.#pendingCR = false;
    this.#buffer += text;
    const events: SseEvent[] = [];
    let start = 0;
    for (let index = 0; index < this.#buffer.length; index += 1) {
      const char = this.#buffer[index];
      if (char !== '\n' && char !== '\r') continue;
      const line = this.#buffer.slice(start, index);
      if (char === '\r') {
        if (index + 1 === this.#buffer.length) this.#pendingCR = true;
        else if (this.#buffer[index + 1] === '\n') index += 1;
      }
      start = index + 1;
      const event = this.#line(line);
      if (event !== null) events.push(event);
    }
    this.#buffer = this.#buffer.slice(start);
    return events;
  }

  /** Hết luồng: frame dở (thiếu dòng trống cuối) bị bỏ theo chuẩn. */
  end(): SseEvent[] {
    this.#buffer = '';
    this.#event = '';
    this.#data = [];
    return [];
  }

  #line(line: string): SseEvent | null {
    if (line === '') {
      if (this.#data.length === 0) {
        this.#event = '';
        return null;
      }
      const event = { event: this.#event === '' ? 'message' : this.#event, data: this.#data.join('\n') };
      this.#event = '';
      this.#data = [];
      return event;
    }
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.#event = value;
    else if (field === 'data') this.#data.push(value);
    return null;
  }
}

/** Đọc body SSE của máy chủ Thaigit thành các `AiFrame` (frame lạ bị bỏ qua). */
export async function* readAiFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<AiFrame> {
  const parser = new SseParser();
  const decoder = new TextDecoder();
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      const events = done
        ? parser.push(decoder.decode())
        : parser.push(decoder.decode(value, { stream: true }));
      for (const event of events) {
        const frame = parseAiFrame(event.event, event.data);
        if (frame !== null) yield frame;
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}
