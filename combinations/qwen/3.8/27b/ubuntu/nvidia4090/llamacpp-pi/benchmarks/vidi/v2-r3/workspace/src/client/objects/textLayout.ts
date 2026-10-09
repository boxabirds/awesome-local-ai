/**
 * Story 9 (text.layout): pure text metrics for text objects.
 *
 * `layoutText` wraps a string (explicit newlines + greedy word wrap at the
 * current width limit) and returns the stored box: auto width is the longest
 * line capped at TEXT_MAX_AUTO_WIDTH_WORLD; fixed width is the stored width.
 * `createCanvasMeasurer` wraps canvas `measureText` for the standard font
 * stack and falls back to a deterministic estimate where no canvas exists
 * (jsdom / node), so layout code stays testable and deterministic.
 */
import {
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

export interface TextMetrics {
  /** Box width in board units. */
  width: number;
  /** Box height in board units (line count × font size × TEXT_LINE_HEIGHT). */
  height: number;
  /** The wrapped lines, in order (what a renderer would show). */
  lines: string[];
}

/** Measure the width of `text` rendered at `fontPx` board units. */
export type Measurer = (text: string, fontPx: number) => number;

/** Mean glyph width as a fraction of the font size (estimate fallback). */
export const TEXT_ESTIMATE_GLYPH_RATIO = 0.5;

function estimateWidth(text: string, fontPx: number): number {
  return text.length * fontPx * TEXT_ESTIMATE_GLYPH_RATIO;
}

/**
 * Wrap `text` and compute its box.
 * - mode 'auto': limit = TEXT_MAX_AUTO_WIDTH_WORLD, width = min(longest line, limit)
 * - mode 'fixed': limit = width = fixedWidth (clamped to TEXT_MIN_WIDTH_WORLD)
 * Explicit newlines always break; greedy word wrap fills each line up to the
 * limit; a word wider than the limit stays on its own line.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextMetrics {
  const fontPx = TEXT_SIZES[size];
  const lineH = fontPx * TEXT_LINE_HEIGHT;
  if (text.length === 0) return { width: 0, height: 0, lines: [''] };

  let limit: number;
  let width: number;
  if (mode === 'auto') {
    limit = TEXT_MAX_AUTO_WIDTH_WORLD;
    let longest = 0;
    for (const line of text.split('\n')) {
      const w = measure(line, fontPx);
      if (w > longest) longest = w;
    }
    width = Math.min(longest, limit);
  } else {
    const fw =
      typeof fixedWidth === 'number' && Number.isFinite(fixedWidth) && fixedWidth > 0
        ? fixedWidth
        : TEXT_MIN_WIDTH_WORLD;
    limit = fw;
    width = fw;
  }

  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    if (raw.length === 0) {
      lines.push('');
      continue;
    }
    if (measure(raw, fontPx) <= limit) {
      lines.push(raw);
      continue;
    }
    // Greedy word wrap. Splitting on a single space keeps runs of spaces in
    // the wrapped output (the empty "words" re-add their spaces).
    let current = '';
    for (const word of raw.split(' ')) {
      if (current === '') {
        current = word; // first word, or an overflow word on its own line
      } else if (measure(current + ' ' + word, fontPx) <= limit) {
        current += ' ' + word;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current !== '') lines.push(current);
  }
  return { width, height: lines.length * lineH, lines };
}

/** A Measurer backed by a canvas 2D context, or by the estimate fallback. */
export function createCanvasMeasurer(): Measurer {
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  try {
    const Offscreen = (globalThis as { OffscreenCanvas?: new (w: number, h: number) => OffscreenCanvas })
      .OffscreenCanvas;
    if (typeof Offscreen === 'function') {
      ctx = new Offscreen(1, 1).getContext('2d');
    }
    if (!ctx && typeof document !== 'undefined') {
      ctx = document.createElement('canvas').getContext('2d');
    }
  } catch {
    ctx = null;
  }
  if (!ctx) return estimateWidth;
  const c = ctx;
  return (text, fontPx) => {
    c.font = `${fontPx}px ${TEXT_FONT_FAMILY}`;
    return c.measureText(text).width;
  };
}
