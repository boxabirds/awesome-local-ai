/**
 * Pure text layout function and canvas measurer factory (story 9).
 * Computes the width, height and line breaks for a text object given its
 * content, size preset, width mode and a measurement function.
 */
import {
  TEXT_SIZES,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_FONT_FAMILY,
  type TextSize,
} from '../../shared/config';

/**
 * A measurement function: given text and font size in px, returns the width
 * in world units.
 */
export type Measurer = (text: string, fontPx: number) => number;

/** Average glyph width ratio for the estimate fallback (when canvas is unavailable). */
const AVG_GLYPH_WIDTH_RATIO = 0.6;

/**
 * Create a measurer that uses the canvas 2D context to measure text width.
 * Falls back to a character-count estimate when canvas is unavailable (e.g. jsdom).
 */
export function createCanvasMeasurer(fontFamily?: string): Measurer {
  const family = fontFamily ?? TEXT_FONT_FAMILY;

  // Try to get a canvas context
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
    // Fallback: estimate width as character count × font size × ratio
    return (text: string, fontPx: number): number => {
      return text.length * fontPx * AVG_GLYPH_WIDTH_RATIO;
    };
  }

  return (text: string, fontPx: number): number => {
    ctx!.font = `${fontPx}px ${family}`;
    return ctx!.measureText(text).width;
  };
}

/**
 * Layout text into lines and compute the box dimensions.
 *
 * - Auto mode: width = min(longest line, TEXT_MAX_AUTO_WIDTH_WORLD); greedy word-wrap for lines exceeding the max.
 * - Fixed mode: width = fixedWidth; greedy word-wrap at that width.
 * - Height = line count × font size × TEXT_LINE_HEIGHT.
 * - Explicit newlines are respected (split on \n first).
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const maxWidth = mode === 'fixed' && fixedWidth !== null ? fixedWidth : TEXT_MAX_AUTO_WIDTH_WORLD;

  // Split on explicit newlines first
  const explicitLines = text.split('\n');

  // For each explicit line, apply greedy word-wrap if it exceeds maxWidth
  const wrappedLines: string[] = [];
  for (const line of explicitLines) {
    if (measure(line, fontPx) <= maxWidth) {
      wrappedLines.push(line);
    } else {
      // Greedy word wrap
      const words = line.split(/\s+/).filter((w) => w.length > 0);
      if (words.length === 0) {
        wrappedLines.push('');
        continue;
      }
      let currentLine = '';
      for (const word of words) {
        const candidate = currentLine ? currentLine + ' ' + word : word;
        if (measure(candidate, fontPx) <= maxWidth) {
          currentLine = candidate;
        } else {
          if (currentLine) wrappedLines.push(currentLine);
          currentLine = word;
        }
      }
      if (currentLine) wrappedLines.push(currentLine);
    }
  }

  // Compute width: in auto mode, the longest line's measured width (capped at max);
  // in fixed mode, the fixed width.
  let width: number;
  if (mode === 'fixed' && fixedWidth !== null) {
    width = fixedWidth;
  } else {
    let longest = 0;
    for (const line of wrappedLines) {
      const w = measure(line, fontPx);
      if (w > longest) longest = w;
    }
    width = Math.min(longest, TEXT_MAX_AUTO_WIDTH_WORLD);
  }

  const height = wrappedLines.length * fontPx * TEXT_LINE_HEIGHT;

  return { width, height, lines: wrappedLines };
}
