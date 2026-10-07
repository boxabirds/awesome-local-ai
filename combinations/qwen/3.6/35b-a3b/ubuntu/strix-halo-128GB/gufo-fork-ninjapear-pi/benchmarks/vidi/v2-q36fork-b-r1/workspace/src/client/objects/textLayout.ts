import { TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_SIZES, TEXT_LINE_HEIGHT, TEXT_FONT_FAMILY } from '@/shared/config';
import type { TextSize } from '@/shared/config';

/** Width measurer: returns the world-unit width of `text` at `fontPx`. */
export type Measurer = (text: string, fontPx: number) => number;

/**
 * Create a canvas-based measurer using OffscreenCanvas or a regular canvas element.
 * Falls back to an estimate based on average glyph width ratio when no canvas is available.
 */
export function createCanvasMeasurer(fontFamily = TEXT_FONT_FAMILY): Measurer {
  // Try OffscreenCanvas first
  const offscreen = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(1000, 100) as unknown as HTMLCanvasElement
    : null;

  if (offscreen && offscreen.getContext) {
    const ctx = offscreen.getContext('2d');
    if (ctx) {
      ctx.font = `${16}px ${fontFamily}`;
      return (text: string, fontPx: number): number => {
        ctx.font = `${fontPx}px ${fontFamily}`;
        const m = ctx.measureText(text);
        return m.width;
      };
    }
  }

  // Fallback: estimate based on character count and average glyph width
  // Average proportional width for Latin text ≈ 0.5em at common sizes
  const avgGlyphRatio = 0.5;
  return (_text: string, fontPx: number): number => {
    // Estimate: charCount × fontSize × avgGlyphRatio
    let total = 0;
    for (const ch of _text) {
      if (ch === '\n') continue;
      // Wider characters get slightly more width
      const cw = 'mMWZQ@&OQ0DObph'.includes(ch) ? 1.2 : 0.85;
      total += fontPx * avgGlyphRatio * cw;
    }
    return total;
  };
}

/**
 * Pure text layout function.
 * - Splits on explicit newlines.
 * - Auto mode: each line's width = measured longest sub-word within TEXT_MAX_AUTO_WIDTH_WORLD.
 * - Fixed mode: wraps lines at fixedWidth.
 * - height = number of lines × size × TEXT_LINE_HEIGHT.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const lineHeightPx = fontPx * TEXT_LINE_HEIGHT;

  // Split into explicit lines
  const rawLines = text.split('\n');

  const wrappedLines: string[] = [];

  for (const rawLine of rawLines) {
    if (mode === 'auto') {
      // Measure the whole line; if under max, keep as one line
      const fullW = measure(rawLine, fontPx);
      if (fullW <= TEXT_MAX_AUTO_WIDTH_WORLD) {
        wrappedLines.push(rawLine);
      } else {
        // Greedy word-wrap: split by spaces, reassemble until exceeding max
        const words = rawLine.split(' ');
        let currentLine = '';
        for (let i = 0; i < words.length; i++) {
          const word = words[i];
          const test = currentLine ? `${currentLine} ${word}` : word;
          const testW = measure(test, fontPx);
          if (testW <= TEXT_MAX_AUTO_WIDTH_WORLD) {
            currentLine = test;
          } else {
            // Current line is full; push it
            if (currentLine) wrappedLines.push(currentLine);
            // If this single word still exceeds max, put it anyway
            currentLine = word;
          }
        }
        if (currentLine) wrappedLines.push(currentLine);
      }
    } else {
      // Fixed mode: wrap at fixedWidth
      if (fixedWidth === null) {
        // No fixed width specified — treat like auto with no limit
        wrappedLines.push(rawLine);
      } else {
        const words = rawLine.split(' ');
        let currentLine = '';
        for (let i = 0; i < words.length; i++) {
          const word = words[i];
          const test = currentLine ? `${currentLine} ${word}` : word;
          const testW = measure(test, fontPx);
          if (testW <= fixedWidth) {
            currentLine = test;
          } else {
            if (currentLine) wrappedLines.push(currentLine);
            currentLine = word;
          }
        }
        if (currentLine) wrappedLines.push(currentLine);
      }
    }
  }

  // Compute dimensions
  let maxWidth = 0;
  for (const line of wrappedLines) {
    const w = measure(line, fontPx);
    if (w > maxWidth) maxWidth = w;
  }

  if (mode === 'auto') {
    maxWidth = Math.min(maxWidth, TEXT_MAX_AUTO_WIDTH_WORLD);
  }

  const height = wrappedLines.length * lineHeightPx;

  return {
    width: maxWidth,
    height,
    lines: wrappedLines,
  };
}
