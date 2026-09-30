/**
 * Pure text layout: computes the bounding box (width, height, wrapped lines)
 * for a text object given its content, size preset, width mode, and a measurer.
 *
 * The measurer function converts text + font size into a pixel width in world
 * units. In the browser, `createCanvasMeasurer` uses an OffscreenCanvas or
 * regular canvas; in jsdom or other environments without canvas support, it
 * falls back to a character-count estimate.
 */

import {
  TEXT_AVG_GLYPH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/** Measures the width (in world units) of `text` rendered at `fontPx`. */
export type Measurer = (text: string, fontPx: number) => number;

export interface LayoutResult {
  /** Total width of the text box (auto: min(longest line, max); fixed: fixedWidth). */
  width: number;
  /** Total height: lines × size × TEXT_LINE_HEIGHT. */
  height: number;
  /** The wrapped lines (explicit newlines always start a new line; auto mode also wraps long lines). */
  lines: string[];
}

/**
 * Compute the layout box for a text object.
 *
 * - Auto mode: width = min(longest line, TEXT_MAX_AUTO_WIDTH_WORLD); lines longer
 *   than max are word-wrapped greedily.
 * - Fixed mode: width = fixedWidth; lines are word-wrapped at that width.
 * - Explicit newlines (`\n`) always create a new paragraph; each paragraph wraps
 *   independently.
 * - Height = total number of lines (after wrapping) × font size × TEXT_LINE_HEIGHT.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): LayoutResult {
  const fontPx = TEXT_SIZES[size];
  const maxWidth = mode === 'fixed' && fixedWidth !== null
    ? fixedWidth
    : TEXT_MAX_AUTO_WIDTH_WORLD;

  // Split into paragraphs (explicit newlines)
  const paragraphs = text.split('\n');

  // Wrap each paragraph at maxWidth
  const allLines: string[] = [];
  for (const para of paragraphs) {
    const wrapped = wrapLine(para, fontPx, maxWidth, measure);
    allLines.push(...wrapped);
  }

  // Height = lines × fontPx × line-height
  const height = allLines.length * fontPx * TEXT_LINE_HEIGHT;

  // Width calculation
  let width: number;
  if (mode === 'fixed') {
    width = maxWidth;
  } else {
    // Auto: if any original paragraph needs wrapping, width = max_auto;
    // otherwise width = longest measured line (capped at max)
    let needsWrap = false;
    for (const para of paragraphs) {
      if (measure(para, fontPx) > maxWidth) {
        needsWrap = true;
        break;
      }
    }
    if (needsWrap) {
      width = maxWidth;
    } else {
      let longest = 0;
      for (const line of allLines) {
        const w = measure(line, fontPx);
        if (w > longest) longest = w;
      }
      width = Math.min(longest, TEXT_MAX_AUTO_WIDTH_WORLD);
    }
  }

  return { width, height, lines: allLines };
}

/**
 * Word-wrap a single paragraph (no newlines) at `maxWidth` world units.
 * If the line fits, returns it as-is. Otherwise, greedily places words
 * on lines without exceeding `maxWidth`.
 */
function wrapLine(
  para: string,
  fontPx: number,
  maxWidth: number,
  measure: Measurer,
): string[] {
  if (para.length === 0) return [''];

  const lineWidth = measure(para, fontPx);
  if (lineWidth <= maxWidth) return [para];

  // Greedy word-wrap
  const words = para.split(' ');
  if (words.length === 1) {
    // Single word longer than max: it goes on its own line (no character-level break)
    return [para];
  }

  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine === '') {
      currentLine = word;
    } else {
      const candidate = currentLine + ' ' + word;
      const candidateWidth = measure(candidate, fontPx);
      if (candidateWidth <= maxWidth) {
        currentLine = candidate;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
  }
  if (currentLine !== '') lines.push(currentLine);
  if (lines.length === 0) lines.push('');
  return lines;
}

/**
 * Create a canvas-based measurer. Uses OffscreenCanvas if available, falls
 * back to a document canvas element, and ultimately to a character-count
 * estimate if neither is available (e.g., in jsdom).
 */
export function createCanvasMeasurer(fontFamily?: string): Measurer {
  const family = fontFamily ?? TEXT_FONT_FAMILY;

  // Try OffscreenCanvas
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(1, 1);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        return (text: string, fontPx: number): number => {
          ctx.font = `${fontPx}px ${family}`;
          return ctx.measureText(text).width;
        };
      }
    } catch {
      // Fall through to estimate
    }
  }

  // Try document canvas
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
    } catch {
      // Fall through to estimate
    }
  }

  // Fallback: estimate using average glyph ratio
  return (text: string, fontPx: number): number => {
    return text.length * fontPx * TEXT_AVG_GLYPH_RATIO;
  };
}
