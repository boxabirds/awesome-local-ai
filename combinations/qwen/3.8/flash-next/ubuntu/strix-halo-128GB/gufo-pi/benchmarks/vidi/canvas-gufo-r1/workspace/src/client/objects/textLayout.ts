import {
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/**
 * A function that measures the width (in world units) of a text string at a given font size (px).
 */
export type Measurer = (text: string, fontPx: number) => number;

/** Default average glyph width ratio (approximate em-width). */
const ESTIMATE_GLYPH_RATIO = 0.6;

/**
 * Create a canvas-based measurer. Falls back to character-count estimate if canvas is unavailable.
 */
export function createCanvasMeasurer(fontFamily?: string): Measurer {
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  let attempted = false;

  function getCtx(): typeof ctx {
    if (attempted) return ctx;
    attempted = true;
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        const c = new OffscreenCanvas(1, 1);
        ctx = c.getContext('2d');
      } else if (typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        ctx = c.getContext('2d');
      }
    } catch {
      ctx = null;
    }
    return ctx;
  }

  return (text: string, fontPx: number): number => {
    const c = getCtx();
    if (c) {
      c.font = `${fontPx}px ${fontFamily ?? TEXT_FONT_FAMILY}`;
      return c.measureText(text).width;
    }
    // Fallback estimate
    return text.length * fontPx * ESTIMATE_GLYPH_RATIO;
  };
}

/**
 * Layout text into lines and compute the box dimensions.
 *
 * - Auto mode: width = min(longest line, TEXT_MAX_AUTO_WIDTH_WORLD), lines beyond max wrap greedily.
 * - Fixed mode: width = fixedWidth, lines wrap greedily to fit.
 * - Height = lines × TEXT_SIZES[size] × TEXT_LINE_HEIGHT.
 * - Explicit newlines (\n) are respected as hard breaks.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const hardLines = text.split('\n');

  let maxWidth: number;
  if (mode === 'fixed' && fixedWidth != null) {
    maxWidth = fixedWidth;
  } else {
    // Auto mode: compute the natural width of the longest hard line
    let longest = 0;
    for (const line of hardLines) {
      const w = measure(line, fontPx);
      if (w > longest) longest = w;
    }
    maxWidth = Math.min(longest, TEXT_MAX_AUTO_WIDTH_WORLD);
  }

  // Word-wrap each hard line to fit maxWidth
  const allLines: string[] = [];
  for (const hardLine of hardLines) {
    if (hardLine === '') {
      allLines.push('');
      continue;
    }
    const lineW = measure(hardLine, fontPx);
    if (lineW <= maxWidth) {
      allLines.push(hardLine);
    } else {
      // Greedy word wrap
      const words = hardLine.split(' ');
      let current = '';
      for (const word of words) {
        const test = current === '' ? word : current + ' ' + word;
        const testW = measure(test, fontPx);
        if (testW <= maxWidth || current === '') {
          current = test;
        } else {
          allLines.push(current);
          current = word;
        }
      }
      if (current !== '') {
        allLines.push(current);
      }
    }
  }

  // Compute actual width from all lines
  let computedWidth = 0;
  for (const line of allLines) {
    const w = measure(line, fontPx);
    if (w > computedWidth) computedWidth = w;
  }

  // In auto mode, the box width is the min of computed width and max
  // In fixed mode, the box width is fixedWidth
  let boxWidth: number;
  if (mode === 'fixed' && fixedWidth != null) {
    boxWidth = fixedWidth;
  } else {
    boxWidth = Math.min(computedWidth, TEXT_MAX_AUTO_WIDTH_WORLD);
  }

  const lineHeight = fontPx * TEXT_LINE_HEIGHT;
  const boxHeight = allLines.length * lineHeight;

  return { width: boxWidth, height: boxHeight, lines: allLines };
}
