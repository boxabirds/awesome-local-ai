/**
 * Pure text layout function and canvas measurer for text objects (story 9).
 */
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_FONT_FAMILY,
  type TextSize,
} from '../../shared/config';

/** Measures text width in world units at the given font size. */
export type Measurer = (text: string, fontPx: number) => number;

/** Average glyph width ratio (fallback when canvas is unavailable). */
const AVERAGE_GLYPH_RATIO = 0.6;

/**
 * Creates a canvas-based measurer. Falls back to a character-count estimate
 * when canvas/OffscreenCanvas is unavailable (e.g. jsdom).
 */
export function createCanvasMeasurer(fontFamily?: string): Measurer {
  const family = fontFamily ?? TEXT_FONT_FAMILY;

  // Try to get a canvas context
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

  if (ctx) {
    return (text: string, fontPx: number): number => {
      ctx!.font = `${fontPx}px ${family}`;
      const metrics = ctx!.measureText(text);
      return metrics.width;
    };
  }

  // Fallback: estimate width from character count
  return (text: string, fontPx: number): number => {
    return text.length * fontPx * AVERAGE_GLYPH_RATIO;
  };
}

/**
 * Lays out text given its content, size, width mode, and a measurer.
 *
 * - Auto mode: width = min(longest line, TEXT_MAX_AUTO_WIDTH_WORLD); lines
 *   exceeding the max are greedy-wrapped.
 * - Fixed mode: width = fixedWidth; words wrap at that width.
 * - Height = total line count × TEXT_SIZES[size] × TEXT_LINE_HEIGHT.
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

  if (mode === 'fixed' && fixedWidth != null) {
    width = fixedWidth;
    allLines = wrapLines(rawLines, fontPx, width, measure);
  } else {
    // Auto mode: find the longest raw line width
    let maxLineWidth = 0;
    for (const line of rawLines) {
      const w = measure(line, fontPx);
      if (w > maxLineWidth) maxLineWidth = w;
    }
    width = Math.min(maxLineWidth, TEXT_MAX_AUTO_WIDTH_WORLD);
    // Wrap any line that exceeds the width
    allLines = wrapLines(rawLines, fontPx, width, measure);
  }

  const height = Math.round(allLines.length * fontPx * TEXT_LINE_HEIGHT);

  return { width, height, lines: allLines };
}

/**
 * Greedy word-wrap: wraps lines so each resulting line fits within maxWidth.
 * Words that are wider than maxWidth are placed on their own line (they don't
 * break mid-word).
 */
function wrapLines(
  lines: string[],
  fontPx: number,
  maxWidth: number,
  measure: Measurer,
): string[] {
  const result: string[] = [];

  for (const line of lines) {
    if (line === '') {
      result.push('');
      continue;
    }

    const lineWidth = measure(line, fontPx);
    if (lineWidth <= maxWidth) {
      result.push(line);
      continue;
    }

    // Greedy word wrap
    const words = line.split(' ');
    let currentLine = '';

    for (const word of words) {
      if (currentLine === '') {
        currentLine = word;
      } else {
        const candidate = currentLine + ' ' + word;
        if (measure(candidate, fontPx) <= maxWidth) {
          currentLine = candidate;
        } else {
          result.push(currentLine);
          currentLine = word;
        }
      }
    }

    if (currentLine !== '') {
      result.push(currentLine);
    }
  }

  return result;
}
