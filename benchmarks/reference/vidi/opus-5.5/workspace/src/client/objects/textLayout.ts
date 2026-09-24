/**
 * Pure text layout for free text objects (story 9, text.layout): where lines break and how big
 * the box is. Text measurement is injected (`Measurer`) so the maths is testable; the real one
 * measures with a canvas in the board's text font.
 */
import {
  DEFAULT_TEXT_SIZE,
  TEXT_AUTO_WIDTH_PADDING_WORLD,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/** Width of `text` in world units when set at `fontPx` (world px). */
export type Measurer = (text: string, fontPx: number) => number;

/**
 * Average glyph width as a fraction of the font size, used to estimate widths when no canvas
 * is available (tests, very old browsers). Typical for sans-serif Latin text.
 */
export const ESTIMATE_GLYPH_WIDTH_RATIO = 0.55;

/** Estimate by character count (the fallback measurer). */
export const estimateMeasurer: Measurer = (text, fontPx) => text.length * fontPx * ESTIMATE_GLYPH_WIDTH_RATIO;

type Context2D = { font: string; measureText(text: string): { width: number } };

function canvasContext(): Context2D | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const ctx = new OffscreenCanvas(1, 1).getContext('2d');
      if (ctx) return ctx;
    }
    if (typeof document !== 'undefined') {
      const ctx = document.createElement('canvas').getContext('2d');
      if (ctx) return ctx;
    }
  } catch {
    // No canvas: fall through to the estimate.
  }
  return null;
}

/**
 * Measures with a 2D canvas in `fontFamily` (the same font CSS renders text objects in). Falls
 * back to `estimateMeasurer` when no canvas is available; never throws.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  const ctx = canvasContext();
  if (!ctx) return estimateMeasurer;
  let currentPx = -1;
  return (text, fontPx) => {
    if (fontPx !== currentPx) {
      ctx.font = `${fontPx}px ${fontFamily}`;
      currentPx = fontPx;
    }
    const width = ctx.measureText(text).width;
    return Number.isFinite(width) ? width : estimateMeasurer(text, fontPx);
  };
}

let shared: Measurer | null = null;

/** The app's measurer (created on first use). */
export function textMeasurer(): Measurer {
  shared ??= createCanvasMeasurer(TEXT_FONT_FAMILY);
  return shared;
}

export interface TextLayout {
  width: number;
  height: number;
  lines: string[];
}

/** Font size (world px) of a size preset; unknown presets use the default. */
export function fontPxOf(size: TextSize): number {
  return TEXT_SIZES[size] ?? TEXT_SIZES[DEFAULT_TEXT_SIZE];
}

/** Height of `lineCount` lines at `size`. */
export function linesHeight(lineCount: number, size: TextSize): number {
  return lineCount * fontPxOf(size) * TEXT_LINE_HEIGHT;
}

/** Splits a word wider than `maxWidth` into pieces that fit (at least one character each). */
function breakWord(word: string, maxWidth: number, fontPx: number, measure: Measurer): string[] {
  const pieces: string[] = [];
  let piece = '';
  for (const ch of word) {
    if (piece && measure(piece + ch, fontPx) > maxWidth) {
      pieces.push(piece);
      piece = ch;
    } else {
      piece += ch;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/**
 * Greedy word wrap of one paragraph (no newlines), as CSS `white-space: pre-wrap` with
 * `overflow-wrap: break-word` does: spaces stay at the end of the line they follow (and never
 * count towards its width), a word that does not fit starts a new line, and a word wider than
 * the line is broken between characters.
 */
function wrapParagraph(paragraph: string, maxWidth: number, fontPx: number, measure: Measurer): string[] {
  if (measure(paragraph.trimEnd(), fontPx) <= maxWidth) return [paragraph];
  const tokens = paragraph.match(/\s+|\S+/g) ?? [];
  const lines: string[] = [];
  let line = '';
  for (const token of tokens) {
    if (/^\s/.test(token)) {
      line += token; // hangs at the end of the line
      continue;
    }
    if (measure((line + token).trimEnd(), fontPx) <= maxWidth) {
      line += token;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    if (measure(token, fontPx) <= maxWidth) {
      line = token;
    } else {
      const pieces = breakWord(token, maxWidth, fontPx, measure);
      lines.push(...pieces.slice(0, -1));
      line = pieces[pieces.length - 1] ?? '';
    }
  }
  lines.push(line);
  return lines;
}

/**
 * Lays out `text` at `size`. Explicit newlines always break. Auto mode: width = longest line
 * (including trailing spaces) plus TEXT_AUTO_WIDTH_PADDING_WORLD, at most TEXT_MAX_AUTO_WIDTH_WORLD; lines longer than that
 * wrap. Fixed mode: width = `fixedWidth` (at least TEXT_MIN_WIDTH_WORLD) and lines wrap to it.
 * Height = lines × font size × TEXT_LINE_HEIGHT (text.height). Empty text is one empty line.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = fontPxOf(size);
  const fixed = mode === 'fixed';
  const wrapWidth = fixed
    ? Math.max(TEXT_MIN_WIDTH_WORLD, Number.isFinite(fixedWidth) ? (fixedWidth as number) : TEXT_MIN_WIDTH_WORLD)
    : TEXT_MAX_AUTO_WIDTH_WORLD;
  const lines = text.split('\n').flatMap((p) => wrapParagraph(p, wrapWidth, fontPx, measure));
  let width = wrapWidth;
  if (!fixed) {
    // Trailing spaces count here: the box grows as a space is typed, so the caret keeps room.
    const longest = lines.reduce((max, line) => Math.max(max, measure(line, fontPx)), 0);
    width = Math.min(longest + TEXT_AUTO_WIDTH_PADDING_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD);
  }
  return { width, height: linesHeight(lines.length, size), lines };
}
