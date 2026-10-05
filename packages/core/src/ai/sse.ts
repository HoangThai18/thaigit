// WHATWG-conformant Server-Sent Events reader (enough for both the Thaigit server and OpenAI-style APIs): lines split
// by CRLF/LF/CR, "event:" names the frame, several "data:" lines join with "\n", a blank line dispatches the frame,
// and a ":" line is a comment. A network chunk can cut mid-line (or mid-CRLF), so the parser holds the partial tail

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

  /** Feed one chunk of text, returning the frames that are now complete. */
  push(chunk: string): SseEvent[] {
    let text = chunk;
    // A "\r" at the end of the previous chunk plus a "\n" at the start of this one is ONE line terminator.
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

  /** End of stream: an incomplete frame (missing the final blank line) is dropped, per spec. */
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

/** Parse the Thaigit server's SSE body into `AiFrame`s (unknown frames are ignored). */
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
