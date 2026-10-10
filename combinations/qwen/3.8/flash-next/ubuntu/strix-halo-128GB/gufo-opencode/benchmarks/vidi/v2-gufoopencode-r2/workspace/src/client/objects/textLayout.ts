// Story 9: text measurement and box layout. A Measurer turns a line into a
// pixel width at a font size; layoutText derives the box (width, height,
// lines) from the text, size and width mode. createCanvasMeasurer prefers a
// real canvas and falls back to an estimate so headless environments never
// throw (the estimate also seeds the box before the first real measure).

import {
  TEXT_ESTIMATED_GLYPH_WIDTH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_PADDING_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

export type Measurer = (text: string, fontPx: number) => number;

export const estimateMeasurer: Measurer = (text, fontPx) =>
  text.length * fontPx * TEXT_ESTIMATED_GLYPH_WIDTH_RATIO;

type Context2D = {
  font: string;
  measureText: (text: string) => { width: number };
};

function get2dContext(): Context2D | null {
  try {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const ctx = document.createElement('canvas').getContext('2d');
      if (ctx) return ctx as unknown as Context2D;
    }
    if (typeof OffscreenCanvas !== 'undefined') {
      const ctx = new OffscreenCanvas(1, 1).getContext('2d');
      if (ctx) return ctx as unknown as Context2D;
    }
  } catch {
    // jsdom without the canvas package throws here; fall through to estimate.
  }
  return null;
}

export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  const ctx = get2dContext();
  if (!ctx) return estimateMeasurer;
  return (text, fontPx) => {
    ctx.font = `${fontPx}px ${fontFamily}`;
    return ctx.measureText(text).width;
  };
}

// Defers canvas creation to the first measurement so mounting screens in
// test environments never touches getContext eagerly (falls back to the
// width estimator there anyway).
export function createLazyMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  let inner: Measurer | null = null;
  return (text, fontPx) => {
    if (inner === null) inner = createCanvasMeasurer(fontFamily);
    return inner(text, fontPx);
  };
}

// Greedy word wrap at `max` px. A single word longer than max is never split
// (it overflows its line instead of breaking mid-word).
function wrapLine(line: string, max: number, measure: Measurer, fontPx: number): string[] {
  if (max <= 0 || measure(line, fontPx) <= max || !line.includes(' ')) return [line];
  const words = line.split(' ');
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current === '' || measure(candidate, fontPx) <= max) {
      current = candidate;
    } else {
      out.push(current);
      current = word;
    }
  }
  if (current !== '') out.push(current);
  return out;
}

export interface TextLayout {
  width: number;
  height: number;
  lines: string[];
}

// Auto mode grows with the longest line up to TEXT_MAX_AUTO_WIDTH_WORLD and
// only then wraps; fixed mode always wraps at the stored width. Height is
// line count times font size times TEXT_LINE_HEIGHT.
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = TEXT_SIZES[size];
  const rawLines = text.split('\n');

  if (mode === 'fixed') {
    const width =
      fixedWidth !== null && Number.isFinite(fixedWidth) && fixedWidth > 0
        ? fixedWidth
        : TEXT_MIN_WIDTH_WORLD;
    const lines = rawLines.flatMap((line) => wrapLine(line, width, measure, fontPx));
    return { width, height: lines.length * fontPx * TEXT_LINE_HEIGHT, lines };
  }

  const longest = Math.max(0, ...rawLines.map((line) => measure(line, fontPx)));
  if (longest <= TEXT_MAX_AUTO_WIDTH_WORLD) {
    return {
      width: Math.min(longest + TEXT_PADDING_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD),
      height: rawLines.length * fontPx * TEXT_LINE_HEIGHT,
      lines: rawLines,
    };
  }
  const width = TEXT_MAX_AUTO_WIDTH_WORLD;
  const lines = rawLines.flatMap((line) => wrapLine(line, width, measure, fontPx));
  return { width, height: lines.length * fontPx * TEXT_LINE_HEIGHT, lines };
}
