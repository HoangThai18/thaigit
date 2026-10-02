/**
 * Đo độ rộng chữ của nhãn nhánh bằng canvas với đúng font của viên nhãn (CSS `.pill-text`: 600 11px font UI), có nhớ đệm.
 * Cần để xếp "+N" khi nhãn tràn ô — DOM không cho biết chữ rộng bao nhiêu mà không dựng và đo từng phần tử.
 */
const cache = new Map<string, number>();
let context: CanvasRenderingContext2D | null | undefined;
let fontKey = '';

export const PILL_FONT_SIZE = 11;
export const PILL_FONT_WEIGHT = 600;

function ensureContext(fontFamily: string): CanvasRenderingContext2D | null {
  if (context === undefined) {
    context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  if (context && fontKey !== fontFamily) {
    fontKey = fontFamily;
    context.font = `${PILL_FONT_WEIGHT} ${PILL_FONT_SIZE}px ${fontFamily}`;
    cache.clear();
  }
  return context;
}

/** Độ rộng (px) của `text`; không có canvas (môi trường lạ) thì ước lượng 6,3px/ký tự. */
export function measurePillText(text: string, fontFamily: string): number {
  const cached = cache.get(text);
  if (cached !== undefined && fontKey === fontFamily) return cached;
  const ctx = ensureContext(fontFamily);
  const width = ctx ? ctx.measureText(text).width : text.length * 6.3;
  if (cache.size > 5000) cache.clear();
  cache.set(text, width);
  return width;
}
