import {
  TEXT_CARET_ROOM_WORLD,
  TEXT_ESTIMATED_GLYPH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../shared/config';
import type { TextSize } from '../../shared/config';

export type Measurer = (text: string, fontPx: number) => number; // width in world units

const estimate: Measurer = (text, fontPx) => text.length * fontPx * TEXT_ESTIMATED_GLYPH_RATIO;

/** Measures with a canvas 2D context; falls back to a per-character estimate when none is available. */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  let ctx: { font: string; measureText(t: string): { width: number } } | null = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      ctx = new OffscreenCanvas(1, 1).getContext('2d');
    } else if (typeof document !== 'undefined' && !/jsdom/i.test(navigator.userAgent)) {
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
      return Number.isFinite(w) && (w > 0 || text.length === 0) ? w : estimate(text, fontPx);
    } catch {
      return estimate(text, fontPx);
    }
  };
}

/** Splits a single word wider than `limit` into pieces by character. */
function breakWord(word: string, limit: number, fontPx: number, measure: Measurer): string[] {
  const pieces: string[] = [];
  let piece = '';
  for (const ch of Array.from(word)) {
    if (piece !== '' && measure(piece + ch, fontPx) > limit) {
      pieces.push(piece);
      piece = '';
    }
    piece += ch;
  }
  if (piece !== '') pieces.push(piece);
  return pieces;
}

/** Greedy word wrap of one paragraph. */
function wrapLine(line: string, limit: number, fontPx: number, measure: Measurer): string[] {
  if (measure(line, fontPx) <= limit) return [line];
  const out: string[] = [];
  let current = '';
  // Whitespace stays attached to the word before it so the lines re-join exactly.
  for (const token of line.match(/\S+\s*|\s+/g) ?? [line]) {
    if (current !== '' && measure((current + token).trimEnd(), fontPx) <= limit) {
      current += token;
      continue;
    }
    if (current !== '') out.push(current);
    if (measure(token.trimEnd(), fontPx) <= limit) {
      current = token;
    } else {
      const pieces = breakWord(token, limit, fontPx, measure);
      current = pieces.pop() ?? '';
      out.push(...pieces);
    }
  }
  if (current !== '') out.push(current);
  return out;
}

export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const limit = mode === 'fixed' && fixedWidth !== null ? fixedWidth : TEXT_MAX_AUTO_WIDTH_WORLD;
  const lines = text.split('\n').flatMap((line) => wrapLine(line, limit, fontPx, measure));
  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
  if (mode === 'fixed' && fixedWidth !== null) return { width: fixedWidth, height, lines };
  // Measured before wrapping: any line that had to wrap makes the box the full maximum width.
  const longest = Math.max(0, ...text.split('\n').map((l) => measure(l.trimEnd(), fontPx)));
  return { width: Math.min(longest + TEXT_CARET_ROOM_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD), height, lines };
}

let shared: Measurer | null = null;

/** The measurer the board uses; created on first use so jsdom never touches a canvas early. */
export function getDefaultMeasurer(): Measurer {
  return (shared ??= createCanvasMeasurer());
}

/** Test seam: replaces the shared measurer (null restores the canvas one). */
export function setDefaultMeasurer(measure: Measurer | null): void {
  shared = measure;
}
