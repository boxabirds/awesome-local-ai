import {
  TEXT_AVG_GLYPH_RATIO, TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_MIN_WIDTH_WORLD,
  TEXT_PADDING_WORLD, TEXT_SIZES, type TextSize,
} from '../../shared/config';

/** Width of `text` in world units when set at `fontPx`. */
export type Measurer = (text: string, fontPx: number) => number;

const estimate: Measurer = (text, fontPx) => text.length * fontPx * TEXT_AVG_GLYPH_RATIO;

/** Canvas text measurement; falls back to a character-count estimate where no canvas exists (never throws). */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  let ctx: { font: string; measureText(t: string): { width: number } } | null = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      ctx = new OffscreenCanvas(1, 1).getContext('2d');
    } else if (typeof document !== 'undefined' && !/jsdom/i.test(globalThis.navigator?.userAgent ?? '')) {
      ctx = document.createElement('canvas').getContext('2d');
    }
  } catch {
    ctx = null;
  }
  if (!ctx) return estimate;
  const c = ctx;
  return (text, fontPx) => {
    try {
      c.font = `${fontPx}px ${fontFamily}`;
      const w = c.measureText(text).width;
      return Number.isFinite(w) ? w : estimate(text, fontPx);
    } catch {
      return estimate(text, fontPx);
    }
  };
}

/** Breaks one paragraph greedily at spaces; a word wider than the limit is split by characters. */
function wrapLine(line: string, maxWidth: number, fontPx: number, measure: Measurer): string[] {
  if (measure(line, fontPx) <= maxWidth) return [line];
  const out: string[] = [];
  let cur = '';
  const push = () => { out.push(cur); cur = ''; };
  for (const token of line.split(/(?<= )/)) { // words keep their trailing space
    const candidate = cur + token;
    if (measure(candidate.trimEnd(), fontPx) <= maxWidth) { cur = candidate; continue; }
    if (cur !== '') push();
    if (measure(token.trimEnd(), fontPx) <= maxWidth) { cur = token; continue; }
    for (const ch of Array.from(token)) { // over-long word
      if (cur !== '' && measure(cur + ch, fontPx) > maxWidth) push();
      cur += ch;
    }
  }
  if (cur !== '' || out.length === 0) push();
  return out;
}

export function layoutText(
  text: string, size: TextSize, mode: 'auto' | 'fixed', fixedWidth: number | null, measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const limit = mode === 'fixed'
    ? Math.max(TEXT_MIN_WIDTH_WORLD, fixedWidth ?? TEXT_MIN_WIDTH_WORLD)
    : TEXT_MAX_AUTO_WIDTH_WORLD;
  const paragraphs = text.split('\n');
  const lines = paragraphs.flatMap((p) => wrapLine(p, limit, fontPx, measure));
  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
  if (mode === 'fixed') return { width: limit, height, lines };
  // The box is as wide as the longest unwrapped line, so a wrapped paragraph fills the whole maximum width.
  const longest = Math.max(0, ...paragraphs.map((l) => measure(l.trimEnd(), fontPx)));
  return { width: Math.min(longest + TEXT_PADDING_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD), height, lines };
}

let shared: Measurer | null = null;
/** One canvas measurer for the whole page. */
export function sharedMeasurer(): Measurer {
  return (shared ??= createCanvasMeasurer());
}
