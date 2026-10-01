import {
  TEXT_ESTIMATE_GLYPH_RATIO, TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_MIN_WIDTH_WORLD,
  TEXT_PADDING_WORLD, TEXT_SIZES, type TextSize,
} from '../../shared/config';

/** Width in world units of one line of `text` at `fontPx`. */
export type Measurer = (text: string, fontPx: number) => number;

const estimate: Measurer = (text, fontPx) => text.length * fontPx * TEXT_ESTIMATE_GLYPH_RATIO;

/** Measures with a canvas 2D context; without one (jsdom, workers) it estimates by character count. Never throws. */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  type Ctx = { font: string; measureText(t: string): { width: number } };
  let ctx = null as Ctx | null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      ctx = new OffscreenCanvas(1, 1).getContext('2d') as typeof ctx;
    } else if (typeof document !== 'undefined' && !/jsdom/i.test(navigator.userAgent)) {
      ctx = document.createElement('canvas').getContext('2d') as typeof ctx;
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

let shared: Measurer | null = null;
/** One lazily created measurer for the whole app. */
export function defaultMeasurer(): Measurer {
  shared ??= createCanvasMeasurer();
  return shared;
}

/** Greedy word wrap of one logical line to `maxWidth`; a word wider than that is broken by character. */
function wrapLine(line: string, maxWidth: number, fontPx: number, measure: Measurer): string[] {
  if (measure(line, fontPx) <= maxWidth) return [line];
  const out: string[] = [];
  let current: string | null = null;
  for (const word of line.split(' ')) {
    const candidate: string = current === null ? word : `${current} ${word}`;
    if (measure(candidate, fontPx) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current !== null) out.push(current);
    current = null;
    if (measure(word, fontPx) <= maxWidth) {
      current = word;
      continue;
    }
    let piece = '';
    for (const ch of word) {
      if (piece !== '' && measure(piece + ch, fontPx) > maxWidth) {
        out.push(piece);
        piece = '';
      }
      piece += ch;
    }
    current = piece;
  }
  out.push(current ?? '');
  return out;
}

export function layoutText(
  text: string, size: TextSize, mode: 'auto' | 'fixed', fixedWidth: number | null, measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const fixed = mode === 'fixed' && fixedWidth !== null && Number.isFinite(fixedWidth);
  const wrapAt = fixed ? Math.max(TEXT_MIN_WIDTH_WORLD, fixedWidth) : TEXT_MAX_AUTO_WIDTH_WORLD;
  const logical = text.split('\n');
  const lines = logical.flatMap((l) => wrapLine(l, wrapAt, fontPx, measure));
  const longest = Math.max(0, ...logical.map((l) => measure(l, fontPx)));
  const width = fixed ? wrapAt : Math.min(longest + TEXT_PADDING_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD);
  return { width, height: lines.length * fontPx * TEXT_LINE_HEIGHT, lines };
}
