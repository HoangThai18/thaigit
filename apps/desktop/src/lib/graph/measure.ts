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
export function measurePillText(text: string, fontFamily: string): number {
  const cached = cache.get(text);
  if (cached !== undefined && fontKey === fontFamily) return cached;
  const ctx = ensureContext(fontFamily);
  const width = ctx ? ctx.measureText(text).width : text.length * 6.3;
  if (cache.size > 5000) cache.clear();
  cache.set(text, width);
  return width;
}
