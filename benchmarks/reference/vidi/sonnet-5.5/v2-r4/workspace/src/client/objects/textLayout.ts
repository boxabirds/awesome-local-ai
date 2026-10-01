import {
  TEXT_ESTIMATE_GLYPH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_PADDING_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/** Width in world units of `text` set at `fontPx`. */
export type Measurer = (text: string, fontPx: number) => number;

const estimate: Measurer = (text, fontPx) => text.length * fontPx * TEXT_ESTIMATE_GLYPH_RATIO;

/** Measures with a canvas 2D context; without one (no canvas, jsdom) falls back to a character-count estimate. Never throws. */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  let ctx: { font: string; measureText(t: string): { width: number } } | null | undefined;
  const context = () => {
    if (ctx !== undefined) return ctx;
    ctx = null;
    try {
      if (typeof OffscreenCanvas !== 'undefined') ctx = new OffscreenCanvas(1, 1).getContext('2d');
      else if (typeof document !== 'undefined' && !/jsdom/i.test(globalThis.navigator?.userAgent ?? ''))
        ctx = document.createElement('canvas').getContext('2d');
    } catch {
      ctx = null;
    }
    return ctx;
  };
  return (text, fontPx) => {
    try {
      const c = context();
      if (!c) return estimate(text, fontPx);
      c.font = `${fontPx}px ${fontFamily}`;
      const w = c.measureText(text).width;
      return Number.isFinite(w) ? w : estimate(text, fontPx);
    } catch {
      return estimate(text, fontPx);
    }
  };
}

let shared: Measurer | null = null;
/** One lazily created canvas measurer for the whole app. */
export function defaultMeasurer(): Measurer {
  return (shared ??= createCanvasMeasurer());
}

/** Greedy word wrap of one logical line to `maxWidth`; a single word wider than that is split by character. */
function wrapLine(line: string, maxWidth: number, fontPx: number, measure: Measurer): string[] {
  if (measure(line, fontPx) <= maxWidth) return [line];
  const out: string[] = [];
  let current = '';
  const flush = () => {
    out.push(current);
    current = '';
  };
  for (const token of line.split(/(?<= )/)) {
    const candidate = current + token;
    if (measure(candidate.trimEnd(), fontPx) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current !== '') flush();
    if (measure(token.trimEnd(), fontPx) <= maxWidth) {
      current = token;
      continue;
    }
    for (const ch of token) {
      if (current !== '' && measure((current + ch).trimEnd(), fontPx) > maxWidth) flush();
      current += ch;
    }
  }
  if (current !== '' || out.length === 0) flush();
  return out;
}

/**
 * Auto mode: width = longest line (plus caret room) up to TEXT_MAX_AUTO_WIDTH_WORLD, longer lines wrap.
 * Fixed mode: width = fixedWidth, lines wrap to it. Height always follows the content.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const limit = mode === 'fixed' && fixedWidth !== null ? fixedWidth : TEXT_MAX_AUTO_WIDTH_WORLD;
  const logical = text.split('\n');
  const lines = logical.flatMap((l) => wrapLine(l, limit, fontPx, measure));
  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
  if (mode === 'fixed' && fixedWidth !== null) return { width: fixedWidth, height, lines };
  // Once any line has to wrap the box takes the full line length, as a wrapped paragraph would.
  if (lines.length > logical.length) return { width: TEXT_MAX_AUTO_WIDTH_WORLD, height, lines };
  const longest = Math.max(0, ...lines.map((l) => measure(l.trimEnd(), fontPx)));
  return { width: Math.min(longest + TEXT_PADDING_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD), height, lines };
}
