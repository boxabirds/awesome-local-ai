/**
 * Text layout (story 9).
 *
 * Pure functions that compute the bounding box of a text object given its
 * content, size, width mode and a text measurer. No side effects, no DOM
 * requirement in the core `layoutText`; `createCanvasMeasurer` does use
 * canvas but falls back gracefully.
 */
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_FONT_FAMILY,
  type TextSize,
} from '../../shared/config';

/** Text width measurement callback: returns width in world units for the given text at given font px. */
export type Measurer = (text: string, fontPx: number) => number;

/** Average glyph width as a fraction of font size (fallback when canvas unavailable). */
const AVG_GLYPH_RATIO = 0.55;

/**
 * Create a canvas-based text measurer.
 * Falls back to character-count estimation when canvas is unavailable.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  let ctx: { font: string; measureText(text: string): { width: number } } | null = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(1, 1);
      const c = canvas.getContext('2d');
      if (c) ctx = c as unknown as { font: string; measureText(text: string): { width: number } };
    } else if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      const c = canvas.getContext('2d');
      if (c) ctx = c as unknown as { font: string; measureText(text: string): { width: number } };
    }
  } catch {
    // Canvas unavailable
  }

  if (ctx !== null) {
    const ctxRef = ctx;
    return (text: string, fontPx: number): number => {
      ctxRef.font = `${fontPx}px ${fontFamily}`;
      const metrics = ctxRef.measureText(text);
      return metrics.width;
    };
  }

  // Fallback: estimate using character count × avg glyph width.
  return (text: string, fontPx: number): number => {
    return text.length * fontPx * AVG_GLYPH_RATIO;
  };
}

/**
 * Layout a text string into a bounding box.
 *
 * - Auto mode: width = min(longest measured line, TEXT_MAX_AUTO_WIDTH_WORLD);
 *   lines exceeding max auto width wrap via greedy word wrap.
 * - Fixed mode: width = fixedWidth; text wraps to fit.
 * - Height = total lines × TEXT_SIZES[size] × TEXT_LINE_HEIGHT.
 * - Explicit newlines split lines.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const lineHeight = fontPx * TEXT_LINE_HEIGHT;

  // Split on explicit newlines first.
  const rawLines = text.split('\n');

  // Determine the effective wrap width.
  const wrapWidth = mode === 'fixed' && fixedWidth !== null
    ? fixedWidth
    : TEXT_MAX_AUTO_WIDTH_WORLD;

  const lines: string[] = [];

  for (const rawLine of rawLines) {
    if (rawLine.length === 0) {
      lines.push('');
      continue;
    }

    const measuredWidth = measure(rawLine, fontPx);

    if (mode === 'auto' && measuredWidth <= TEXT_MAX_AUTO_WIDTH_WORLD) {
      // Fits in one line in auto mode.
      lines.push(rawLine);
    } else {
      // Need to wrap this line.
      const wrapped = wrapLine(rawLine, wrapWidth, fontPx, measure);
      lines.push(...wrapped);
    }
  }

  // Compute the final width.
  let maxWidth = 0;
  for (const line of lines) {
    const w = measure(line, fontPx);
    if (w > maxWidth) maxWidth = w;
  }

  let finalWidth: number;
  if (mode === 'fixed' && fixedWidth !== null) {
    finalWidth = fixedWidth;
  } else {
    // Auto mode: width = longest line, up to max.
    finalWidth = Math.min(maxWidth, TEXT_MAX_AUTO_WIDTH_WORLD);
  }

  // Ensure minimum: at least some width.
  finalWidth = Math.max(finalWidth, TEXT_SIZES[size] * AVG_GLYPH_RATIO);

  const height = lines.length * lineHeight;

  return { width: finalWidth, height, lines };
}

/** Greedy word-wrap a single line to fit within the given width. */
function wrapLine(
  line: string,
  maxWidth: number,
  fontPx: number,
  measure: Measurer,
): string[] {
  const words = line.split(' ');
  if (words.length === 0) return [''];

  const result: string[] = [];
  let current = words[0]!;

  for (let i = 1; i < words.length; i++) {
    const word = words[i]!;
    const candidate = current + ' ' + word;
    if (measure(candidate, fontPx) <= maxWidth) {
      current = candidate;
    } else {
      result.push(current);
      current = word;
    }
  }

  result.push(current);
  return result;
}