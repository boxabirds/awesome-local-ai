// WCAG 2.2 contrast (relative luminance). Used by the token tests and by anyone choosing new colours.

/** WCAG 2.2 AA minimums: 1.4.3 for text, 1.4.11 for UI boundaries (borders, focus rings, fills). */
export const MIN_TEXT_CONTRAST = 4.5;
export const MIN_UI_CONTRAST = 3;

export type ContrastKind = 'text' | 'ui';

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** '#rrggbb' or '#rgb' to [r, g, b] (0-255). */
export function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace(/^#/, '');
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** True when `ratio` meets the minimum for its kind. No rounding: 4.49 fails text, 4.5 passes. */
export function meetsContrast(ratio: number, kind: ContrastKind): boolean {
  return ratio >= (kind === 'text' ? MIN_TEXT_CONTRAST : MIN_UI_CONTRAST);
}
