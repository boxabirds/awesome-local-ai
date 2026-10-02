/**
 * Text layout: measures text and computes width/height for text objects.
 * Pure logic; uses a Measurer callback so it can be tested without canvas.
 */
import type { TextSize } from '../../shared/config';
import { TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_SIZES, TEXT_LINE_HEIGHT, TEXT_FONT_FAMILY } from '../../shared/config';

/**
 * Measures the width (in world units) of a text string rendered at the given font size.
 */
export type Measurer = (text: string, fontPx: number) => number;

/**
 * Creates a canvas-based measurer. Falls back to an estimate when no canvas
 * is available (e.g. jsdom).
 */
export function createCanvasMeasurer(fontFamily?: string): Measurer {
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  const font = fontFamily ?? TEXT_FONT_FAMILY;

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

  if (ctx) {
    return (text: string, fontPx: number): number => {
      (ctx as CanvasRenderingContext2D).font = `${fontPx}px ${font}`;
      return (ctx as CanvasRenderingContext2D).measureText(text).width;
    };
  }

  // Fallback: estimate average glyph width as 0.6 × fontPx
  const AVG_GLYPH_RATIO = 0.6;
  return (text: string, fontPx: number): number => {
    return text.length * fontPx * AVG_GLYPH_RATIO;
  };
}

export interface LayoutResult {
  width: number;
  height: number;
  lines: string[];
}

/**
 * Compute the layout of a text object.
 *
 * @param text - The raw text content (may contain newlines)
 * @param size - The text size preset key
 * @param mode - 'auto' (grow then wrap) or 'fixed' (wrap at fixedWidth)
 * @param fixedWidth - Used when mode is 'fixed'
 * @param measure - The text measurement function
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): LayoutResult {
  const fontPx = TEXT_SIZES[size];

  if (text === '') {
    const height = Math.round(fontPx * TEXT_LINE_HEIGHT);
    return { width: 0, height, lines: [''] };
  }

  const rawLines = text.split('\n');

  if (mode === 'fixed') {
    const wrapWidth = fixedWidth ?? TEXT_MAX_AUTO_WIDTH_WORLD;
    const wrapped = wrapLines(rawLines, wrapWidth, fontPx, measure);
    const height = Math.round(wrapped.length * fontPx * TEXT_LINE_HEIGHT);
    return { width: wrapWidth, height, lines: wrapped };
  }

  // Auto mode: width = longest line, capped at TEXT_MAX_AUTO_WIDTH_WORLD
  // First measure all lines to find the widest
  let maxLineWidth = 0;
  for (const line of rawLines) {
    const w = measure(line, fontPx);
    if (w > maxLineWidth) maxLineWidth = w;
  }

  if (maxLineWidth <= TEXT_MAX_AUTO_WIDTH_WORLD) {
    // No wrapping needed
    const height = Math.round(rawLines.length * fontPx * TEXT_LINE_HEIGHT);
    return { width: maxLineWidth, height, lines: rawLines };
  }

  // Need to wrap lines that exceed the max auto width
  const wrapped = wrapLines(rawLines, TEXT_MAX_AUTO_WIDTH_WORLD, fontPx, measure);
  // Width is the actual widest wrapped line (may be less than TEXT_MAX_AUTO_WIDTH_WORLD)
  let widest = 0;
  for (const line of wrapped) {
    const w = measure(line, fontPx);
    if (w > widest) widest = w;
  }
  // Width should be at most TEXT_MAX_AUTO_WIDTH_WORLD
  const width = Math.min(widest, TEXT_MAX_AUTO_WIDTH_WORLD);
  const height = Math.round(wrapped.length * fontPx * TEXT_LINE_HEIGHT);
  return { width, height, lines: wrapped };
}

/**
 * Greedy word-wrap: wraps lines that exceed the wrapWidth.
 */
function wrapLines(
  lines: string[],
  wrapWidth: number,
  fontPx: number,
  measure: Measurer,
): string[] {
  const result: string[] = [];
  for (const line of lines) {
    if (measure(line, fontPx) <= wrapWidth) {
      result.push(line);
      continue;
    }
    // Greedy word wrap
    const words = line.split(' ');
    let current = '';
    for (const word of words) {
      const test = current === '' ? word : current + ' ' + word;
      if (measure(test, fontPx) <= wrapWidth) {
        current = test;
      } else {
        if (current !== '') result.push(current);
        // Handle words longer than wrapWidth: put them on their own line
        current = word;
      }
    }
    if (current !== '') result.push(current);
  }
  return result.length > 0 ? result : [''];
}
