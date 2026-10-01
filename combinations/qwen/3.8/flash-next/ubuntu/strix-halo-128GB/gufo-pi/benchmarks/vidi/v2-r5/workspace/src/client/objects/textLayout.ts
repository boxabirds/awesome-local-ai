import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_SIZES,
  TEXT_FONT_FAMILY,
  type TextSize,
} from '../../shared/config';

/**
 * Text layout: a pure function that computes width and height for a text object,
 * given a text string, size, mode, fixed width, and a text measurer.
 */

/** Measure the width (in world units) of a string at a given font size. */
export type Measurer = (text: string, fontPx: number) => number;

/** Average glyph width as a fraction of font size (used as fallback estimate). */
const AVG_GLYPH_RATIO = 0.55;

/**
 * Create a canvas-based text measurer. Falls back to a character-count estimate
 * when canvas/OffscreenCanvas is unavailable (e.g. in jsdom).
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

  if (!ctx) {
    // Fallback: estimate width from character count
    return (text: string, fontPx: number) => text.length * fontPx * AVG_GLYPH_RATIO;
  }

  const font = fontFamily ?? TEXT_FONT_FAMILY;

  return (text: string, fontPx: number): number => {
    ctx!.font = `${fontPx}px ${font}`;
    const metrics = ctx!.measureText(text);
    return metrics.width;
  };
}

/**
 * Greedy word-wrap a single line to fit within maxWidth.
 * Returns the wrapped lines.
 */
function wrapLine(line: string, maxWidth: number, fontPx: number, measure: Measurer): string[] {
  if (line.length === 0) return [''];

  const lineWidth = measure(line, fontPx);
  if (lineWidth <= maxWidth) return [line];

  // No spaces → can't break, put the whole word on one line (overflow)
  const words = line.split(' ');
  if (words.length === 1) return [line];

  const result: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (measure(candidate, fontPx) <= maxWidth || current.length === 0) {
      current = candidate;
    } else {
      result.push(current);
      current = word;
    }
  }

  if (current.length > 0) result.push(current);
  return result;
}

/**
 * Layout text to compute width and height.
 *
 * Auto mode: width = min(longest line width, TEXT_MAX_AUTO_WIDTH_WORLD).
 * Lines longer than the auto max are wrapped greedily.
 *
 * Fixed mode: width = fixedWidth. Lines are wrapped greedily to that width.
 *
 * Height = number of wrapped lines × TEXT_SIZES[size] × TEXT_LINE_HEIGHT.
 * Explicit newlines (\n) are always respected.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const rawLines = text.split('\n');

  let allLines: string[];
  let width: number;

  if (mode === 'fixed' && fixedWidth !== null) {
    width = fixedWidth;
    allLines = [];
    for (const line of rawLines) {
      allLines.push(...wrapLine(line, width, fontPx, measure));
    }
  } else {
    // Auto mode: compute the width as min of longest raw line and TEXT_MAX_AUTO_WIDTH_WORLD
    const longestRawWidth = rawLines.reduce((max, line) => {
      const w = measure(line, fontPx);
      return w > max ? w : max;
    }, 0);
    width = Math.min(longestRawWidth, TEXT_MAX_AUTO_WIDTH_WORLD);
    // Wrap lines that exceed the computed width
    allLines = [];
    for (const line of rawLines) {
      allLines.push(...wrapLine(line, width, fontPx, measure));
    }
  }

  const height = allLines.length * fontPx * TEXT_LINE_HEIGHT;
  return { width, height, lines: allLines };
}
