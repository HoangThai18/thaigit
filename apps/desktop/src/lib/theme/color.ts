/** Small colour helpers for labels (pills) and avatars: colours are computed in TS so `color-mix()` isn't needed (older WebKit lacks it). */

export type Rgb = readonly [number, number, number];

/** `#rrggbb` (or `#rgb`) → [r, g, b]; a malformed string → neutral grey. */
export function parseHex(hex: string): Rgb {
  let digits = hex.trim().replace(/^#/, '');
  if (digits.length === 3) digits = digits.replace(/./g, (c) => c + c);
  if (!/^[0-9a-f]{6}/i.test(digits)) return [128, 128, 128];
  const value = Number.parseInt(digits.slice(0, 6), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Blend `amount` (0…1) of `other` into `base` (like `NSColor.blended(withFraction:of:)`). */
export function mixRgb(base: Rgb, other: Rgb, amount: number): Rgb {
  const channel = (a: number, b: number): number => Math.round(a + (b - a) * amount);
  return [channel(base[0], other[0]), channel(base[1], other[1]), channel(base[2], other[2])];
}

/** `rgb(r g b / a)` — CSS Color 4 syntax, supported on Safari 12.1+ / Chromium 65+. */
export function rgbCss(rgb: Rgb, alpha = 1): string {
  return alpha >= 1
    ? `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`
    : `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / ${Number(alpha.toFixed(3))})`;
}

export const WHITE: Rgb = [255, 255, 255];
export const BLACK: Rgb = [0, 0, 0];
export const GRAY: Rgb = [128, 128, 128];
