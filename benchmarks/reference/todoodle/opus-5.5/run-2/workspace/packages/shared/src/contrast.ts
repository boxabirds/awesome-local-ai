/** WCAG 2.2 contrast helpers (relative luminance of sRGB hex colours). */

export const TEXT_CONTRAST_MIN = 4.5;
export const UI_CONTRAST_MIN = 3;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((part) => channel(Number.parseInt(part, 16))) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text needs 4.5:1 (1.4.3); UI boundaries such as borders and focus rings need 3:1 (1.4.11). */
export function meetsContrast(kind: 'text' | 'ui', ratio: number): boolean {
  return ratio >= (kind === 'text' ? TEXT_CONTRAST_MIN : UI_CONTRAST_MIN);
}
