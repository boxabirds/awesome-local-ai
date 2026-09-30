// Text layout (story 9, text.layout): the box a text object needs, computed
// from its content with a pluggable width measurer. Pure apart from the
// canvas measurer.
import {
  TEXT_AVG_GLYPH_WIDTH_RATIO,
  TEXT_CARET_ALLOWANCE_WORLD,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/** Width of `text` in world units at font size `fontPx` (world units). */
export type Measurer = (text: string, fontPx: number) => number;

/** Box values are rounded to this many steps per world unit, so re-measuring never writes noise. */
const ROUND_STEPS = 100;

function round(v: number): number {
  return Math.round(v * ROUND_STEPS) / ROUND_STEPS;
}

/** Character-count estimate for environments without canvas. */
export const estimateMeasurer: Measurer = (text, fontPx) => text.length * fontPx * TEXT_AVG_GLYPH_WIDTH_RATIO;

/**
 * Measures with a 2D canvas in `fontFamily`, the font the board renders text
 * in. Without a canvas (server, jsdom) it falls back to the estimate; it never throws.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  let ctx: { font: string; measureText(t: string): { width: number } } | null = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      ctx = new OffscreenCanvas(1, 1).getContext('2d');
    }
    // jsdom implements <canvas> without a context (and logs when asked for one).
    const jsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
    if (!ctx && typeof document !== 'undefined' && !jsdom) {
      ctx = document.createElement('canvas').getContext('2d');
    }
  } catch {
    ctx = null;
  }
  if (!ctx) return estimateMeasurer;
  const c = ctx;
  return (text, fontPx) => {
    try {
      c.font = `${fontPx}px ${fontFamily}`;
      const w = c.measureText(text).width;
      return Number.isFinite(w) ? w : estimateMeasurer(text, fontPx);
    } catch {
      return estimateMeasurer(text, fontPx);
    }
  };
}

let defaultMeasurer: Measurer | null = null;

/** The board's shared measurer (created on first use). */
export function getTextMeasurer(): Measurer {
  defaultMeasurer ??= createCanvasMeasurer(TEXT_FONT_FAMILY);
  return defaultMeasurer;
}

/** Replaces the shared measurer (tests use a deterministic fake); null restores the default. */
export function setTextMeasurer(measure: Measurer | null): void {
  defaultMeasurer = measure;
}

/** Breaks one word wider than `limit` into pieces that fit (at least one character each). */
function breakWord(word: string, limit: number, width: (s: string) => number): string[] {
  const pieces: string[] = [];
  let piece = '';
  for (const ch of word) {
    if (piece !== '' && width(piece + ch) > limit) {
      pieces.push(piece);
      piece = ch;
    } else {
      piece += ch;
    }
  }
  if (piece !== '') pieces.push(piece);
  return pieces;
}

/**
 * Greedy word wrap of one paragraph (no newlines) at `limit`. Spaces after a
 * word stay on its line and never count towards the width (like CSS pre-wrap).
 */
function wrapParagraph(paragraph: string, limit: number, width: (s: string) => number): string[] {
  if (width(paragraph.trimEnd()) <= limit) return [paragraph];
  const tokens = paragraph.match(/\s*\S+\s*/g) ?? [paragraph];
  const lines: string[] = [];
  let line = '';
  for (const token of tokens) {
    const candidate = line + token;
    if (width(candidate.trimEnd()) <= limit) {
      line = candidate;
      continue;
    }
    if (line !== '') lines.push(line);
    if (width(token.trimEnd()) <= limit) {
      line = token;
    } else {
      const pieces = breakWord(token, limit, (s) => width(s.trimEnd()));
      lines.push(...pieces.slice(0, -1));
      line = pieces[pieces.length - 1] ?? '';
    }
  }
  if (line !== '' || lines.length === 0) lines.push(line);
  return lines;
}

/**
 * The box of a text object. Explicit newlines are kept. Auto width: as wide as
 * the longest line (plus a small caret allowance) up to TEXT_MAX_AUTO_WIDTH_WORLD,
 * wrapping longer lines. Fixed width: wraps at `fixedWidth` (at least
 * TEXT_MIN_WIDTH_WORLD). Height is always lines × size × TEXT_LINE_HEIGHT.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size] ?? TEXT_SIZES.M;
  const width = (s: string) => {
    const w = measure(s, fontPx);
    return Number.isFinite(w) ? w : estimateMeasurer(s, fontPx);
  };
  const limit =
    mode === 'fixed' ? Math.max(TEXT_MIN_WIDTH_WORLD, fixedWidth ?? TEXT_MIN_WIDTH_WORLD) : TEXT_MAX_AUTO_WIDTH_WORLD;
  const paragraphs = text.split('\n');
  const lines = paragraphs.flatMap((p) => wrapParagraph(p, limit, width));
  let boxWidth: number;
  if (mode === 'fixed' || lines.length > paragraphs.length) {
    // Fixed, or auto text that had to wrap: the box is the wrapping width.
    boxWidth = limit;
  } else {
    const longest = Math.max(0, ...lines.map((l) => width(l.trimEnd())));
    boxWidth = Math.min(TEXT_MAX_AUTO_WIDTH_WORLD, longest + TEXT_CARET_ALLOWANCE_WORLD);
  }
  return { width: round(boxWidth), height: round(lines.length * fontPx * TEXT_LINE_HEIGHT), lines };
}
