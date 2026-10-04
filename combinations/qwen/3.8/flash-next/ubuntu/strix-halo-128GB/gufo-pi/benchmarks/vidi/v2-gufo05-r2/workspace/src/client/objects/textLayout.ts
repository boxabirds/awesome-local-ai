/**
 * Story 9: laying out a text object — the pure maths, and the one place that
 * asks a browser how wide a word is.
 *
 * Height always follows the content (PRD text.height): lines × font size ×
 * TEXT_LINE_HEIGHT. Width is either automatic — as wide as its longest line, up
 * to TEXT_MAX_AUTO_WIDTH_WORLD, longer lines wrapping — or the width somebody
 * dragged a side handle to.
 *
 * The function is pure and takes the measurer as an argument, so the wrapping
 * rules can be tested with an exact fake and run in the browser with real font
 * metrics: which words land on which line is decided by the font, and no test
 * doubles as a font renderer.
 */

import {
  TEXT_AUTO_WIDTH_PAD_WORLD,
  TEXT_ESTIMATED_GLYPH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/** Width in board units of `text` drawn at `fontPx`. */
export type Measurer = (text: string, fontPx: number) => number;

/** The board's own canvas-backed measurer, created once per page. */
let boardMeasurer: Measurer | null = null;

/** A width guessed from the character count, for anywhere there is no canvas. */
function estimateWidth(text: string, fontPx: number): number {
  return text.length * fontPx * TEXT_ESTIMATED_GLYPH_RATIO;
}

interface Context2dLike {
  font: string;
  measureText(text: string): { width: number };
}

/** The 2d context of a canvas this environment can give us, or null. */
function drawingContext(): Context2dLike | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const context = new OffscreenCanvas(1, 1).getContext('2d') as Context2dLike | null;
      if (context) return context;
    }
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext?.('2d') as Context2dLike | null | undefined;
      if (context) return context;
    }
  } catch {
    // No canvas of any kind: the estimate is the answer (TC-32).
  }
  return null;
}

/**
 * A measurer that uses the browser's font metrics, falling back to a character
 * count where there is no canvas (a worker, jsdom, a canvas that refused). It
 * never throws, and it is never asked twice for the same font string.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  const context = drawingContext();
  if (!context) return estimateWidth;
  let font = '';
  return (text, fontPx) => {
    try {
      const next = `${fontPx}px ${fontFamily}`;
      if (next !== font) {
        context.font = next;
        font = next;
      }
      return context.measureText(text).width;
    } catch {
      return estimateWidth(text, fontPx);
    }
  };
}

/** The one measurer the board writes boxes with. */
export function boardMeasurerRef(): Measurer {
  if (!boardMeasurer) boardMeasurer = createCanvasMeasurer();
  return boardMeasurer;
}

export interface TextLayout {
  width: number;
  height: number;
  lines: string[];
}

/** Measure one line, treating a measurer that fails as an estimate (never throws). */
function lineWidth(
  line: string,
  fontPx: number,
  measure: Measurer,
): number {
  try {
    const width = measure(line, fontPx);
    return Number.isFinite(width) ? width : estimateWidth(line, fontPx);
  } catch {
    return estimateWidth(line, fontPx);
  }
}

/**
 * Greedy word wrap: fill the line until the next word would not fit, then start
 * a new one. A single word wider than the line is broken at the width, because
 * that is what `overflow-wrap: break-word` does on screen — and the height has to
 * count the lines the reader actually sees.
 */
function wrapLine(line: string, maxWidth: number, fontPx: number, measure: Measurer): string[] {
  if (maxWidth <= 0) return [line];
  const out: string[] = [];
  for (const paragraph of line.split('\n')) {
    let current = '';
    const flush = () => {
      out.push(current);
      current = '';
    };
    for (const word of paragraph.split(' ')) {
      const candidate = current ? `${current} ${word}` : word;
      if (lineWidth(candidate, fontPx, measure) <= maxWidth) {
        current = candidate;
        continue;
      }
      // The word does not fit on the current line.
      if (current) flush();
      let remainder = word;
      while (remainder && lineWidth(remainder, fontPx, measure) > maxWidth) {
        // Cut the longest prefix that fits, at least one character per line.
        let low = 1;
        let high = remainder.length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (lineWidth(remainder.slice(0, middle), fontPx, measure) <= maxWidth) low = middle;
          else high = middle - 1;
        }
        out.push(remainder.slice(0, low));
        remainder = remainder.slice(low);
      }
      current = remainder;
    }
    out.push(current);
  }
  return out.length > 0 ? out : [''];
}

/**
 * The box a piece of text needs.
 *
 * - auto: as wide as its longest line, plus a little slack, never more than
 *   TEXT_MAX_AUTO_WIDTH_WORLD; a line beyond that wraps, and the box is exactly
 *   the maximum width.
 * - fixed: exactly `fixedWidth`, with the text rewrapped to it.
 *
 * In both cases the height is the number of lines the reader sees times
 * TEXT_SIZES[size] × TEXT_LINE_HEIGHT (PRD text.height).
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = TEXT_SIZES[size] ?? TEXT_SIZES.M;
  const paragraphs = text.split('\n');

  let width: number;
  let lines: string[];

  if (mode === 'fixed' && fixedWidth !== null && Number.isFinite(fixedWidth) && fixedWidth > 0) {
    width = fixedWidth;
    lines = paragraphs.flatMap((line) => wrapLine(line, width, fontPx, measure));
  } else {
    let longest = 0;
    for (const line of paragraphs) {
      longest = Math.max(longest, lineWidth(line, fontPx, measure));
    }
    if (longest <= TEXT_MAX_AUTO_WIDTH_WORLD) {
      width = Math.min(longest + TEXT_AUTO_WIDTH_PAD_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD);
      lines = paragraphs;
    } else {
      width = TEXT_MAX_AUTO_WIDTH_WORLD;
      lines = paragraphs.flatMap((line) => wrapLine(line, width, fontPx, measure));
    }
  }

  // An empty object is still one line tall, so it has a box to select.
  if (lines.length === 0) lines = [''];
  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
  return { width: Math.max(width, 1), height: Math.max(height, 1), lines };
}
