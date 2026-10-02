import {
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_FONT_FAMILY,
  TEXT_AVG_GLYPH_WIDTH_RATIO,
  type TextSize,
} from '../../shared/config';

/**
 * A function that measures the width (in world units) of a string rendered
 * at a given font size in pixels.
 */
export type Measurer = (text: string, fontPx: number) => number;

/**
 * Create a measurer that uses the canvas 2D context's `measureText` API.
 * Falls back to a character-count estimate when canvas is unavailable
 * (e.g. jsdom). Never throws.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  // Try to get a canvas context. In jsdom or SSR this will fail.
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    if (typeof document !== 'undefined' && document.createElement) {
      const canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d');
    }
  } catch {
    ctx = null;
  }

  if (!ctx) {
    // Fallback: estimate using average glyph width ratio.
    return (text: string, fontPx: number) => {
      if (text.length === 0) return 0;
      return text.length * fontPx * TEXT_AVG_GLYPH_WIDTH_RATIO;
    };
  }

  return (text: string, fontPx: number) => {
    if (text.length === 0) return 0;
    ctx!.font = `${fontPx}px ${fontFamily}`;
    return ctx!.measureText(text).width;
  };
}

/**
 * Layout a text string into lines, computing the resulting box dimensions.
 *
 * - Splits on explicit newlines first.
 * - In auto mode: width = min(longest line, TEXT_MAX_AUTO_WIDTH_WORLD); lines
 *   longer than the max are greedily word-wrapped.
 * - In fixed mode: width = fixedWidth; all lines are greedily word-wrapped to
 *   fit that width.
 * - Height = number of lines × TEXT_SIZES[size] × TEXT_LINE_HEIGHT.
 *
 * Greedy word wrap: words are separated by spaces. A word that is longer than
 * the available width on its own gets hard-broken (character-level split).
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];

  // Split into explicit lines first.
  const explicitLines = text.split('\n');

  // For auto mode, we need to find the longest line to determine width.
  // For fixed mode, width is given.
  let boxWidth: number;

  if (mode === 'fixed' && fixedWidth !== null) {
    boxWidth = fixedWidth;
  } else {
    // Auto: find the longest line (after measuring), capped at max.
    let longest = 0;
    for (const line of explicitLines) {
      const w = measure(line, fontPx);
      if (w > longest) longest = w;
    }
    boxWidth = Math.min(longest, TEXT_MAX_AUTO_WIDTH_WORLD);
  }

  // Now wrap each explicit line to fit within boxWidth.
  const allLines: string[] = [];
  for (const line of explicitLines) {
    const wrapped = wrapLine(line, boxWidth, measure, fontPx);
    allLines.push(...wrapped);
  }

  // Ensure at least one line (for empty text).
  if (allLines.length === 0) allLines.push('');

  const height = allLines.length * fontPx * TEXT_LINE_HEIGHT;

  return { width: boxWidth, height, lines: allLines };
}

/**
 * Greedy word-wrap a single line to fit within `maxWidth`.
 * Returns an array of lines.
 */
function wrapLine(
  line: string,
  maxWidth: number,
  measure: Measurer,
  fontPx: number,
): string[] {
  if (line.length === 0) return [''];
  if (measure(line, fontPx) <= maxWidth) return [line];

  const words = line.split(' ');
  const result: string[] = [];
  let current = '';

  for (const word of words) {
    // Try adding the word to the current line.
    const candidate = current.length === 0 ? word : current + ' ' + word;
    if (measure(candidate, fontPx) <= maxWidth) {
      current = candidate;
    } else {
      // The word doesn't fit on the current line.
      if (current.length > 0) {
        result.push(current);
        current = '';
      }
      // Check if the word itself is too long (hard break needed).
      if (measure(word, fontPx) > maxWidth) {
        // Hard-break the word character by character.
        let chunk = '';
        for (const ch of word) {
          const test = chunk.length === 0 ? ch : chunk + ch;
          if (measure(test, fontPx) <= maxWidth) {
            chunk = test;
          } else {
            if (chunk.length > 0) result.push(chunk);
            chunk = ch;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
  }

  if (current.length > 0) result.push(current);
  return result.length > 0 ? result : [''];
}
