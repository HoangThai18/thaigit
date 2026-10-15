/**
 * Measure label text width on a canvas using the exact font of the pill (CSS `.pill-text`: 600 11px UI
 * font), with memoisation. Needed to place "+N" when labels overflow the cell — the DOM cannot report
 * text width without laying out and measuring every element.
 */
const cache = new Map<string, number>();
let context: CanvasRenderingContext2D | null | undefined;
let fontKey = '';

export const PILL_FONT_SIZE = 11;
export const PILL_FONT_WEIGHT = 600;
/** `.pill.current` draws the checked-out branch bolder — measured with the same weight or "main" gets cut to "m…". */
export const PILL_CURRENT_FONT_WEIGHT = 700;

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

/** Width (px) of `text`; without a canvas (exotic environment) fall back to 6.3px per character. */
export function measurePillText(text: string, fontFamily: string, bold = false): number {
  const key = bold ? `b\u0000${text}` : text;
  const cached = cache.get(key);
  if (cached !== undefined && fontKey === fontFamily) return cached;
  const ctx = ensureContext(fontFamily);
  let width = text.length * (bold ? 6.6 : 6.3);
  if (ctx) {
    ctx.font = `${bold ? PILL_CURRENT_FONT_WEIGHT : PILL_FONT_WEIGHT} ${PILL_FONT_SIZE}px ${fontFamily}`;
    width = ctx.measureText(text).width;
  }
  if (cache.size > 5000) cache.clear();
  cache.set(key, width);
  return width;
}
