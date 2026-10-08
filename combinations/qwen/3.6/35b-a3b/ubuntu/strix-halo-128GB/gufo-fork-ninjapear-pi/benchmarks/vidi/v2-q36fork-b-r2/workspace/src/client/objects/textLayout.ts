import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_FONT_FAMILY,
} from '../../shared/config';
import type { TextSize } from '../../shared/config';

export type Measurer = (text: string, fontPx: number) => number; // width in world units

/** Average glyph width ratio constant for estimate fallback. */
const AVG_GLYPH_RATIO = 0.5;

/** Create a canvas-based measurer that falls back to character-count estimate without canvas. */
export function createCanvasMeasurer(fontFamily?: string): Measurer {
  const family = fontFamily || TEXT_FONT_FAMILY;

  // Try OffscreenCanvas first (Node.js environment may have it)
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(1000, 100);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        return (text: string, fontPx: number): number => {
          ctx.font = `${fontPx}px ${family}`;
          return ctx.measureText(text).width;
        };
      }
    } catch { /* ignore */ }
  }

  // Try HTMLCanvasElement (browser environment)
  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        return (text: string, fontPx: number): number => {
          ctx.font = `${fontPx}px ${family}`;
          return ctx.measureText(text).width;
        };
      }
    } catch { /* ignore */ }
  }

  // Fallback: estimate by character count × average glyph width ratio × size
  return (_text: string, fontPx: number): number => {
    // Estimate: roughly 0.5em per character on average
    const charCount = _text.length;
    return charCount * fontPx * AVG_GLYPH_RATIO;
  };
}

interface LayoutResult {
  width: number;
  height: number;
  lines: string[];
}

/**
 * Pure layout function: given text, size, width mode, and measurer,
 * compute rendered width, height, and word-wrapped lines.
 *
 * - Auto mode: width = min(longest line, TEXT_MAX_AUTO_WIDTH_WORLD), greedy word wrap beyond max
 * - Fixed mode: width = fixedWidth, wraps at that width
 * - Height = lineCount × TEXT_SIZES[size] × TEXT_LINE_HEIGHT
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): LayoutResult {
  const fontPx = TEXT_SIZES[size as keyof typeof TEXT_SIZES];
  const lineHeight = fontPx * TEXT_LINE_HEIGHT;

  if (!text) {
    return { width: 0, height: 0, lines: [] };
  }

  // Split on explicit newlines first
  const rawLines = text.split('\n');

  // Wrap each raw line to fit within constraints
  let maxWidth: number;
  if (mode === 'fixed' && fixedWidth !== null) {
    maxWidth = fixedWidth;
  } else {
    maxWidth = Infinity; // no constraint for auto mode initial measurement
  }

  // Helper: wrap a single line to fit maxWidth using greedy word wrap,
  // with overflow break for words exceeding the limit.
  function wrapLine(line: string, limit: number): string[] {
    if (line.length === 0) return [''];
    if (limit <= 0) return [line]; // shouldn't happen but safety

    // Split into words
    const words = line.split(/(\s+)/); // keep whitespace tokens
    const result: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const wordWidth = measure(word, fontPx);
      const currentWidth = currentLine ? measure(currentLine + ' ', fontPx) : 0;

      // Check if adding this word would exceed the limit
      if (currentWidth + wordWidth > limit) {
        // If we have content on the current line, flush it
        if (currentLine) {
          result.push(currentLine.trimEnd());
          currentLine = '';
        }
        // Overflow-break: if the word itself exceeds limit, split character by character
        if (wordWidth > limit) {
          // Measure characters until they'd exceed the limit
          let acc = '';
          for (const ch of word) {
            const test = acc + ch;
            if (measure(test, fontPx) > limit && acc.length > 0) {
              result.push(acc);
              acc = ch;
            } else {
              acc = test;
            }
          }
          if (acc) {
            currentLine = acc;
          }
        } else {
          currentLine = word;
        }
      } else {
        currentLine += word;
      }
    }

    if (currentLine.trimEnd()) {
      result.push(currentLine.trimEnd());
    }

    return result.length > 0 ? result : [line];
  }

  // In auto mode, do two-pass wrapping:
  // Pass 1: no width constraint → measure longest line
  // Pass 2: if longest > cap, re-wrap at capped width
  let allLines: string[] = [];
  if (mode === 'auto' && rawLines.length > 0) {
    // First pass: wrap without constraint
    for (const rawLine of rawLines) {
      allLines = allLines.concat(wrapLine(rawLine, Infinity));
    }

    // Measure widest line
    let maxMeasured = 0;
    for (const line of allLines) {
      const w = measure(line, fontPx);
      if (w > maxMeasured) maxMeasured = w;
    }

    // If any line exceeds the cap, re-wrap with capped width
    if (maxMeasured > TEXT_MAX_AUTO_WIDTH_WORLD) {
      allLines = [];
      for (const rawLine of rawLines) {
        allLines = allLines.concat(
          wrapLine(rawLine, TEXT_MAX_AUTO_WIDTH_WORLD),
        );
      }
    }
  } else {
    // Fixed mode or empty text
    for (const rawLine of rawLines) {
      allLines = allLines.concat(wrapLine(rawLine, maxWidth));
    }
  }

  // Compute final width from actual widest line
  let maxMeasured = 0;
  for (const line of allLines) {
    const w = measure(line, fontPx);
    if (w > maxMeasured) maxMeasured = w;
  }

  let finalWidth: number;
  if (mode === 'fixed' && fixedWidth !== null) {
    finalWidth = fixedWidth;
  } else {
    finalWidth = maxMeasured;
  }

  // Clamp minimum width
  finalWidth = Math.max(finalWidth, 0);

  const height = allLines.length * lineHeight;

  return {
    width: finalWidth,
    height,
    lines: allLines,
  };
}
