import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_SIZES,
  TEXT_FONT_FAMILY,
  type TextSize,
} from '../../shared/config';

/**
 * Pure text layout (story 9, text.layout). Measures and wraps text into a
 * box of (width, height) in world units. `measure` returns the width in world
 * units of a single line of text at a given font size in px (world units at
 * zoom 1).
 */

/** Measures the width (world units) of `text` rendered at `fontPx`. */
export type Measurer = (text: string, fontPx: number) => number;

/** Horizontal padding (world units) on each side of the measured text. */
export const TEXT_BOX_PADDING = 4;

/** Average glyph width as a ratio of font size, for the estimate fallback. */
export const AVERAGE_GLYPH_WIDTH_RATIO = 0.6;

/**
 * Estimates the width of `text` at `fontPx` without a canvas: character count
 * × font size × a named average-glyph-width ratio. Used as the fallback when
 * no 2d canvas context is available (TC-32) and for the initial box estimate.
 */
export function estimateTextWidth(text: string, fontPx: number): number {
  return text.length * fontPx * AVERAGE_GLYPH_WIDTH_RATIO;
}

/**
 * Canvas-backed measurer. Returns a Measurer that measures text at `fontPx`
 * using a 2d canvas. When no canvas 2d context is available (e.g. jsdom),
 * falls back to {@link estimateTextWidth} and never throws (TC-32).
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d');
    }
  } catch {
    ctx = null;
  }
  if (!ctx) {
    return (text, fontPx) => estimateTextWidth(text, fontPx);
  }
  return (text: string, fontPx: number) => {
    ctx!.font = `${fontPx}px ${fontFamily}`;
    return ctx!.measureText(text).width;
  };
}

/** Greedy word-wrap of `line` so each resulting line measures ≤ maxWidth. */
function wrapLine(line: string, maxWidth: number, measure: Measurer, fontPx: number): string[] {
  if (line === '') return [''];
  const words = line.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current === '' || measure(candidate, fontPx) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

/**
 * Lays out `text` at the given size and width mode.
 * - auto:  width = min(longest line + padding, TEXT_MAX_AUTO_WIDTH_WORLD),
 *          greedy word-wrap beyond TEXT_MAX_AUTO_WIDTH_WORLD.
 * - fixed: width = fixedWidth, wrapping to it.
 * - height = lines × TEXT_SIZES[size] × TEXT_LINE_HEIGHT (always follows content).
 * Explicit newlines are respected.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const maxWidth = mode === 'fixed' && fixedWidth != null ? fixedWidth : TEXT_MAX_AUTO_WIDTH_WORLD;

  const explicitLines = text.split('\n');
  const allLines: string[] = [];
  for (const line of explicitLines) {
    allLines.push(...wrapLine(line, maxWidth, measure, fontPx));
  }

  let longest = 0;
  for (const line of allLines) {
    const w = measure(line, fontPx);
    if (w > longest) longest = w;
  }

  const height = Math.max(1, allLines.length) * fontPx * TEXT_LINE_HEIGHT;
  const width =
    mode === 'fixed' && fixedWidth != null
      ? fixedWidth
      : Math.min(longest + 2 * TEXT_BOX_PADDING, TEXT_MAX_AUTO_WIDTH_WORLD);

  return { width, height, lines: allLines };
}
