// Text object layout (story 9): pure line breaking and box size, given a measurer.
import {
  TEXT_AVG_GLYPH_WIDTH_RATIO,
  TEXT_CARET_SLACK_WORLD,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/** Width of `text` on one line at `fontPx`, in world units. */
export type Measurer = (text: string, fontPx: number) => number;

/** Character-count estimate used when text cannot be measured (no canvas). */
export const estimateMeasurer: Measurer = (text, fontPx) =>
  text.length * fontPx * TEXT_AVG_GLYPH_WIDTH_RATIO;

type Context2D = { font: string; measureText(text: string): { width: number } };

function createContext(): Context2D | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const ctx = new OffscreenCanvas(1, 1).getContext('2d');
      if (ctx) return ctx;
    }
    if (typeof document !== 'undefined') {
      const ctx = document.createElement('canvas').getContext('2d');
      if (ctx && typeof ctx.measureText === 'function') return ctx;
    }
  } catch {
    // No canvas (tests, very old browsers): fall back to the estimate.
  }
  return null;
}

/** Measures with a 2D canvas in the given font; falls back to an estimate without canvas. */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  const ctx = createContext();
  if (!ctx) return estimateMeasurer;
  return (text, fontPx) => {
    ctx.font = `${fontPx}px ${fontFamily}`;
    const width = ctx.measureText(text).width;
    return Number.isFinite(width) ? width : estimateMeasurer(text, fontPx);
  };
}

let shared: Measurer | null = null;

/** The app's measurer, created on first use. */
export function textMeasurer(): Measurer {
  shared ??= createCanvasMeasurer(TEXT_FONT_FAMILY);
  return shared;
}

/** Splits a word that is wider than `max` into pieces that fit (at least one character each). */
function breakWord(word: string, max: number, width: (s: string) => number): string[] {
  const pieces: string[] = [];
  let piece = '';
  for (const ch of word) {
    if (piece !== '' && width(piece + ch) > max) {
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
 * Greedy word wrap of one paragraph (no newlines) at `max`. Spaces at a break stay at the end
 * of the line they follow and never cause a wrap (like CSS `white-space: pre-wrap`).
 */
function wrapParagraph(paragraph: string, max: number, width: (s: string) => number): string[] {
  if (width(paragraph.trimEnd()) <= max) return [paragraph];
  const lines: string[] = [];
  let line = '';
  for (const token of paragraph.match(/\s+|\S+/g) ?? []) {
    if (/^\s/.test(token)) {
      line += token;
      continue;
    }
    if (width(line + token) <= max) {
      line += token;
      continue;
    }
    if (line.trim() !== '') lines.push(line);
    line = '';
    if (width(token) <= max) {
      line = token;
    } else {
      const pieces = breakWord(token, max, width);
      lines.push(...pieces.slice(0, -1));
      line = pieces[pieces.length - 1] ?? '';
    }
  }
  lines.push(line);
  return lines;
}

/**
 * Lays text out: explicit newlines are kept; auto mode is as wide as the longest line (plus
 * room for the caret, at least TEXT_MIN_WIDTH_WORLD) up to TEXT_MAX_AUTO_WIDTH_WORLD and wraps
 * beyond it; fixed mode wraps at `fixedWidth`. Height is always lines × font size × line height.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const width = (s: string) => measure(s.trimEnd(), fontPx);
  const fixed = mode === 'fixed' && fixedWidth !== null && Number.isFinite(fixedWidth);
  const max = fixed ? Math.max(fixedWidth!, TEXT_MIN_WIDTH_WORLD) : TEXT_MAX_AUTO_WIDTH_WORLD;
  const paragraphs = text.split('\n');
  const lines = paragraphs.flatMap((p) => wrapParagraph(p, max, width));
  let boxWidth = max;
  if (!fixed) {
    // Longest line before wrapping: once any line wraps, the box is the full maximum width.
    const longest = Math.max(0, ...paragraphs.map(width));
    boxWidth = Math.min(
      Math.max(Math.ceil(longest) + TEXT_CARET_SLACK_WORLD, TEXT_MIN_WIDTH_WORLD),
      TEXT_MAX_AUTO_WIDTH_WORLD,
    );
  }
  // Rounded so the stored box has no floating-point noise (e.g. 26.000000000000004).
  const height = Math.round(lines.length * fontPx * TEXT_LINE_HEIGHT * 100) / 100;
  return { width: boxWidth, height, lines };
}
