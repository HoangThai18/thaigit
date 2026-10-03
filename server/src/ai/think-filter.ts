// Lọc khối <think>…</think> ngay trong luồng (Hermes 4 là model lai có lập luận): phần suy nghĩ không gửi về app. Thẻ
// có thể bị cắt ngang giữa hai chunk nên giữ lại phần đuôi có thể là đầu của thẻ.

const OPEN = '<think>';
const CLOSE = '</think>';

/** Độ dài phần đuôi của `text` trùng với phần đầu của `tag` (để chờ chunk sau). */
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
  /** Đã phát chữ thật nào chưa (để bỏ khoảng trắng đầu sau khối suy nghĩ). */
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

  /** Hết luồng: phần chờ không thành thẻ thì trả ra (trừ khi đang trong khối suy nghĩ). */
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
