// Filters <think>…</think> blocks right inside the stream (Hermes 4 is a hybrid reasoning model): the reasoning is never sent
// to the app. A tag can be split across two chunks, so the tail that could start a tag is held back.

const OPEN = '<think>';
const CLOSE = '</think>';

/** Length of the `text` tail that is also a prefix of `tag` (waiting for the next chunk). */
function partialSuffix(text: string, tag: string): number {
  const lower = text.toLowerCase();
  for (let length = Math.min(tag.length - 1, text.length); length > 0; length -= 1) {
    if (tag.startsWith(lower.slice(-length))) return length;
  }
  return 0;
}

export class ThinkFilter {
  #inThink = false;
  #pending = '';
  /** Whether any real text has been emitted yet (used to drop leading whitespace after a reasoning block). */
  #started = false;

  push(chunk: string): string {
    let text = this.#pending + chunk;
    this.#pending = '';
    let out = '';
    while (text !== '') {
      const lower = text.toLowerCase();
      if (this.#inThink) {
        const end = lower.indexOf(CLOSE);
        if (end === -1) {
          const keep = partialSuffix(text, CLOSE);
          this.#pending = keep > 0 ? text.slice(-keep) : '';
          return this.#emit(out);
        }
        this.#inThink = false;
        text = text.slice(end + CLOSE.length);
        continue;
      }
      const start = lower.indexOf(OPEN);
      if (start === -1) {
        const keep = partialSuffix(text, OPEN);
        out += text.slice(0, text.length - keep);
        this.#pending = keep > 0 ? text.slice(-keep) : '';
        return this.#emit(out);
      }
      out += text.slice(0, start);
      this.#inThink = true;
      text = text.slice(start + OPEN.length);
    }
    return this.#emit(out);
  }

  /** End of stream: a pending fragment that never became a tag is emitted (unless we are inside a reasoning block). */
  end(): string {
    const rest = this.#inThink ? '' : this.#pending;
    this.#pending = '';
    return this.#emit(rest);
  }

  #emit(text: string): string {
    if (this.#started) return text;
    const trimmed = text.replace(/^\s+/, '');
    if (trimmed !== '') this.#started = true;
    return trimmed;
  }
}
