import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_FONT_FAMILY,
  type TextSize,
} from '@shared/config';

/**
 * A function that measures the width of a text string at a given font size in px.
 * Returns the width in board (world) units.
 */
export type Measurer = (text: string, fontPx: number) => number;

// Average glyph width ratio (em-width approximation for sans-serif).
// Used as a fallback when canvas measurement is unavailable.
const AVG_GLYPH_RATIO = 0.55;

/**
 * Create a canvas-based text measurer. Falls back to character-count estimate
 * if canvas is unavailable (e.g. jsdom without node-canvas).
 */
export function createCanvasMeasurer(fontFamily?: string): Measurer {
  const family = fontFamily ?? TEXT_FONT_FAMILY;

  // Try to get a 2D context for measurement
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
    // Canvas not available
  }

  if (!ctx) {
    // Fallback: estimate based on character count
    return (text: string, fontPx: number) => {
      return text.length * fontPx * AVG_GLYPH_RATIO;
    };
  }

  const context = ctx as CanvasRenderingContext2D;
  return (text: string, fontPx: number) => {
    context.font = `${fontPx}px ${family}`;
    const metrics = context.measureText(text);
    return metrics.width;
  };
}

export interface LayoutResult {
  width: number;
  height: number;
  lines: string[];
}

/**
 * Compute the layout of a text string given a size, width mode, and measurer.
 *
 * - Auto mode: width = min(longest line, TEXT_MAX_AUTO_WIDTH_WORLD), greedy word wrap for lines exceeding max.
 * - Fixed mode: width = fixedWidth, greedy word wrap at that width.
 * - Height = number of lines × font size × TEXT_LINE_HEIGHT.
 * - Explicit newlines are always respected.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): LayoutResult {
  const fontPx = TEXT_SIZES[size];
  const maxAutoWidth = TEXT_MAX_AUTO_WIDTH_WORLD;

  // Split text on explicit newlines
  const rawLines = text.split('\n');

  // Determine the wrap width
  let wrapWidth: number;
  if (mode === 'fixed' && fixedWidth != null) {
    wrapWidth = fixedWidth;
  } else {
    // Auto mode: find longest line's measured width, capped at maxAutoWidth
    let longest = 0;
    for (const line of rawLines) {
      const w = measure(line, fontPx);
      if (w > longest) longest = w;
    }
    wrapWidth = Math.min(longest, maxAutoWidth);
  }

  // Greedy word-wrap each line
  const lines: string[] = [];
  for (const rawLine of rawLines) {
    if (rawLine.length === 0) {
      lines.push('');
      continue;
    }
    // Check if the whole line fits within wrapWidth
    if (measure(rawLine, fontPx) <= wrapWidth) {
      lines.push(rawLine);
      continue;
    }
    // Need to wrap: split into words and greedily pack
    const words = rawLine.split(' ');
    let currentLine = '';
    for (const word of words) {
      const testLine = currentLine.length === 0 ? word : `${currentLine} ${word}`;
      if (measure(testLine, fontPx) <= wrapWidth || currentLine.length === 0) {
        currentLine = testLine;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine.length > 0) {
      lines.push(currentLine);
    }
  }

  // Compute final width
  let width: number;
  if (mode === 'fixed' && fixedWidth != null) {
    width = fixedWidth;
  } else {
    // In auto mode: if any wrapping happened, width = wrapWidth (which is maxAutoWidth)
    // Otherwise, width = longest line measured width (capped at maxAutoWidth)
    let maxLineWidth = 0;
    for (const line of lines) {
      const w = measure(line, fontPx);
      if (w > maxLineWidth) maxLineWidth = w;
    }
    // If we wrapped (lines.length > rawLines.length), use the wrapWidth as the width
    if (lines.length > rawLines.length) {
      width = wrapWidth;
    } else {
      width = Math.min(maxLineWidth, maxAutoWidth);
    }
  }

  // Height = lines * fontSize * lineHeight
  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;

  return { width, height, lines };
}
