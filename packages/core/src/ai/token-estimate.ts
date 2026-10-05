// Estimates token count without the model's tokenizer: ASCII ≈ 3.5 characters/token; non-ASCII (accented Vietnamese,
// CJK, emoji) tokenizes far finer, so ≈ 1.2 characters/token. Deliberately over-estimates — the server still trims if needed.

export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) < 128) ascii += 1;
    else other += 1;
  }
  return Math.ceil(ascii / 3.5 + other / 1.2);
}
