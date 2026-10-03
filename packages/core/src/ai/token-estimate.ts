// Ước lượng số token mà không cần tokenizer của model: ký tự ASCII ≈ 3,5 ký tự/token; ký tự ngoài ASCII (tiếng Việt có
// dấu, CJK, emoji) bị tách nhỏ hơn nhiều nên tính ≈ 1,2 ký tự/token. Cố ý ước lượng dư — máy chủ vẫn cắt thêm nếu cần.

export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) < 128) ascii += 1;
    else other += 1;
  }
  return Math.ceil(ascii / 3.5 + other / 1.2);
}
