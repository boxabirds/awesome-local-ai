/**
 * Text layout: pure measurement and word-wrap logic for text objects (story 9).
 *
 * `layoutText` is pure: given text, size, mode, fixed width, and a measurer,
 * it returns the box and wrapped lines.
 *
 * `createCanvasMeasurer` produces a `Measurer` using a real canvas `measureText`,
 * or falls back to a character-count estimate when canvas is unavailable.
 */
import {
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_FONT_FAMILY,
  type TextSize,
} from '../../shared/config';

/** Measure the width of a text string at a given font size (px → world units). */
export type Measurer = (text: string, fontPx: number) => number;

/** Average glyph width as a fraction of font size, used as fallback when no canvas is available. */
const AVG_GLYPH_RATIO = 0.6;

/**
 * Create a Measurer backed by a real canvas. Falls back to a character-count
 * estimate when canvas (or OffscreenCanvas) is unavailable (e.g. jsdom, node).
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

  const family = fontFamily ?? TEXT_FONT_FAMILY;

  if (ctx) {
    return (text: string, fontPx: number): number => {
      ctx!.font = `${fontPx}px ${family}`;
      return ctx!.measureText(text).width;
    };
  }

  // Fallback estimate: width ≈ text.length × fontPx × AVG_GLYPH_RATIO
  return (text: string, fontPx: number): number => {
    return text.length * fontPx * AVG_GLYPH_RATIO;
  };
}

/**
 * Compute the layout box for a text object.
 *
 * - auto mode: width = min(longest line measurement, TEXT_MAX_AUTO_WIDTH_WORLD);
 *   lines longer than max are greedily word-wrapped.
 * - fixed mode: width = fixedWidth; lines are wrapped to fit that width.
 * - height = total line count × TEXT_SIZES[size] × TEXT_LINE_HEIGHT.
 * - Explicit newlines are always respected.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const paragraphs = text.split('\n');

  // Determine the wrap width and final box width
  let wrapWidth: number;
  let finalWidth: number;
  if (mode === 'fixed' && fixedWidth !== null) {
    wrapWidth = fixedWidth;
    finalWidth = fixedWidth;
  } else {
    // Auto: find the longest paragraph's measurement
    let longest = 0;
    for (const p of paragraphs) {
      const w = measure(p, fontPx);
      if (w > longest) longest = w;
    }
    if (longest <= TEXT_MAX_AUTO_WIDTH_WORLD) {
      // No wrapping needed: width is the longest line
      wrapWidth = longest;
      finalWidth = longest;
    } else {
      // Wrapping needed: width is the cap
      wrapWidth = TEXT_MAX_AUTO_WIDTH_WORLD;
      finalWidth = TEXT_MAX_AUTO_WIDTH_WORLD;
    }
  }

  // Wrap each paragraph to wrapWidth using greedy word wrap
  const lines: string[] = [];
  for (const para of paragraphs) {
    if (para.length === 0) {
      lines.push('');
      continue;
    }
    const paraWidth = measure(para, fontPx);
    if (paraWidth <= wrapWidth) {
      lines.push(para);
    } else {
      // Greedy word wrap
      const words = para.split(' ');
      let currentLine = '';
      for (const word of words) {
        if (currentLine.length === 0) {
          currentLine = word;
        } else {
          const testLine = currentLine + ' ' + word;
          if (measure(testLine, fontPx) <= wrapWidth) {
            currentLine = testLine;
          } else {
            lines.push(currentLine);
            currentLine = word;
          }
        }
      }
      if (currentLine.length > 0) {
        lines.push(currentLine);
      }
    }
  }

  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
  return { width: finalWidth, height, lines };
}
