/**
 * Text layout: pure function to compute text box dimensions,
 * and a canvas-based text measurer with estimate fallback.
 */
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_SIZES,
  TEXT_FONT_FAMILY,
  type TextSize,
} from '../../shared/config';

/** Measures text width in world units at a given font size (px). */
export type Measurer = (text: string, fontPx: number) => number;

/** Average glyph width ratio for the estimate fallback (no canvas). */
const ESTIMATE_GLYPH_RATIO = 0.55;

/**
 * Create a text measurer using canvas measureText. Falls back to a
 * character-count estimate when canvas is unavailable (e.g. jsdom).
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

  if (ctx) {
    return (text: string, fontPx: number): number => {
      (ctx as CanvasRenderingContext2D).font = `${fontPx}px ${font}`;
      return (ctx as CanvasRenderingContext2D).measureText(text).width;
    };
  }

  // Fallback: estimate by character count
  return (text: string, fontPx: number): number => {
    return text.length * fontPx * ESTIMATE_GLYPH_RATIO;
  };
}

/**
 * Greedy word-wrap: split a line into segments that fit within maxWidth.
 * Each word that exceeds maxWidth goes on its own line (overflow).
 */
function wrapLine(line: string, maxWidth: number, measure: Measurer, fontPx: number): string[] {
  if (measure(line, fontPx) <= maxWidth) return [line];

  const words = line.split(' ');
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
 * Compute the layout box for a text object.
 *
 * Auto mode: width = min(longest line measurement, TEXT_MAX_AUTO_WIDTH_WORLD);
 * if a line exceeds that, it wraps greedily at word boundaries.
 *
 * Fixed mode: width = fixedWidth; lines wrap at fixedWidth.
 *
 * Height = number of lines (after wrapping) × font size × TEXT_LINE_HEIGHT.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const sourceLines = text.split('\n');

  let allLines: string[];
  let width: number;

  if (mode === 'fixed' && fixedWidth !== null) {
    width = fixedWidth;
    allLines = [];
    for (const line of sourceLines) {
      const wrapped = wrapLine(line, fixedWidth, measure, fontPx);
      allLines.push(...wrapped);
    }
    // Empty text should have at least one line for height calculation
    if (allLines.length === 0) allLines = [''];
  } else {
    // Auto mode: width = min(longest ORIGINAL line measurement, TEXT_MAX_AUTO_WIDTH_WORLD)
    let longestLineWidth = 0;
    for (const line of sourceLines) {
      const lw = measure(line, fontPx);
      if (lw > longestLineWidth) longestLineWidth = lw;
    }
    width = Math.min(longestLineWidth, TEXT_MAX_AUTO_WIDTH_WORLD);

    // Wrap lines that exceed the max auto width
    allLines = [];
    for (const line of sourceLines) {
      if (measure(line, fontPx) <= TEXT_MAX_AUTO_WIDTH_WORLD) {
        allLines.push(line);
      } else {
        const wrapped = wrapLine(line, TEXT_MAX_AUTO_WIDTH_WORLD, measure, fontPx);
        allLines.push(...wrapped);
      }
    }
    // Empty text should have at least one line
    if (allLines.length === 0) allLines = [''];
  }

  const height = allLines.length * fontPx * TEXT_LINE_HEIGHT;
  return { width, height, lines: allLines };
}
