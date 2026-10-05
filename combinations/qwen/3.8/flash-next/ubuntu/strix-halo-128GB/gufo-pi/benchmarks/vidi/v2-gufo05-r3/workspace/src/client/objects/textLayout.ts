/**
 * Pure text layout for text objects (story 9).
 *
 * `layoutText` computes the width and height of a text object given its content,
 * size preset, width mode and a text measurement function. It never touches the
 * DOM — the measurer is injected so unit tests can use a deterministic fake.
 */
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_FONT_FAMILY,
  type TextSize,
} from '../../shared/config';

/** Measures the pixel (world-unit) width of a string at a given font size. */
export type Measurer = (text: string, fontPx: number) => number;

/** Average glyph width as a fraction of font size, used when canvas is unavailable. */
const AVG_GLYPH_RATIO = 0.6;

/**
 * Create a canvas-based text measurer.
 * Falls back to a character-count estimate when no canvas is available.
 */
export function createCanvasMeasurer(fontFamily?: string): Measurer {
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(1, 1);
      ctx = canvas.getContext('2d');
    } else if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d');
    }
  } catch {
    ctx = null;
  }

  const font = fontFamily ?? TEXT_FONT_FAMILY;

  return (text: string, fontPx: number): number => {
    if (ctx) {
      (ctx as CanvasRenderingContext2D).font = `${fontPx}px ${font}`;
      return (ctx as CanvasRenderingContext2D).measureText(text).width;
    }
    // Fallback estimate
    return text.length * fontPx * AVG_GLYPH_RATIO;
  };
}

export interface TextLayoutResult {
  width: number;
  height: number;
  lines: string[];
}

/**
 * Greedy word wrap: break `line` into lines that each fit within `maxWidth`.
 * If a single word exceeds maxWidth it occupies its own line.
 */
function wordWrap(line: string, maxWidth: number, fontPx: number, measure: Measurer): string[] {
  if (line.length === 0) return [''];
  const words = line.split(' ');
  const result: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else {
      const candidate = current + ' ' + word;
      if (measure(candidate, fontPx) <= maxWidth) {
        current = candidate;
      } else {
        result.push(current);
        current = word;
      }
    }
  }
  result.push(current);
  return result;
}

/**
 * Compute the layout (width, height, wrapped lines) of a text object.
 *
 * @param text - The text content (may contain newlines).
 * @param size - The size preset key.
 * @param mode - 'auto' or 'fixed'.
 * @param fixedWidth - The fixed width (only used in 'fixed' mode).
 * @param measure - Text measurement function.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayoutResult {
  const fontPx = TEXT_SIZES[size];
  const rawLines = text.split('\n');

  if (mode === 'fixed' && fixedWidth != null && fixedWidth > 0) {
    // Fixed mode: wrap each raw line at the fixed width.
    const allLines: string[] = [];
    for (const line of rawLines) {
      const wrapped = wordWrap(line, fixedWidth, fontPx, measure);
      allLines.push(...wrapped);
    }
    return {
      width: fixedWidth,
      height: allLines.length * fontPx * TEXT_LINE_HEIGHT,
      lines: allLines,
    };
  }

  // Auto mode: width = min(longest line measurement, TEXT_MAX_AUTO_WIDTH_WORLD).
  let longestLineWidth = 0;
  for (const line of rawLines) {
    const w = measure(line, fontPx);
    if (w > longestLineWidth) longestLineWidth = w;
  }

  const effectiveWidth = Math.min(longestLineWidth, TEXT_MAX_AUTO_WIDTH_WORLD);

  if (longestLineWidth <= TEXT_MAX_AUTO_WIDTH_WORLD) {
    // No wrapping needed.
    return {
      width: effectiveWidth,
      height: rawLines.length * fontPx * TEXT_LINE_HEIGHT,
      lines: rawLines,
    };
  }

  // Some lines exceed the max auto width — wrap them.
  const allLines: string[] = [];
  for (const line of rawLines) {
    const wrapped = wordWrap(line, TEXT_MAX_AUTO_WIDTH_WORLD, fontPx, measure);
    allLines.push(...wrapped);
  }
  return {
    width: TEXT_MAX_AUTO_WIDTH_WORLD,
    height: allLines.length * fontPx * TEXT_LINE_HEIGHT,
    lines: allLines,
  };
}
