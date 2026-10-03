// Text layout (story 9): pure layout function + canvas measurer.
//
// layoutText is pure: given the text, size preset, width mode and a measurer
// it computes the box (world units) and the wrapped lines. No DOM access, no
// Yjs — testable with a fake measurer.

import {
  TEXT_ESTIMATED_GLYPH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_PADDING_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/** Measures the rendered width of `text` at `fontPx` in world units. */
export type Measurer = (text: string, fontPx: number) => number;

export interface TextLayout {
  width: number;
  height: number;
  lines: string[];
}

/**
 * Greedy word wrap of `line` into lines of at most `maxWidth` world units.
 * Explicit newlines are the caller's concern (split first). A single word
 * wider than the cap stays on its own line (no word splitting).
 */
function wrapLine(
  line: string,
  maxWidth: number,
  fontPx: number,
  measure: Measurer,
): string[] {
  if (line.trim() === '') return [''];
  const words = line.trim().split(/\s+/);
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current !== '' && measure(candidate, fontPx) > maxWidth) {
      out.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  out.push(current);
  return out;
}

/**
 * Compute the layout box for a text object.
 *
 * - auto mode: width = min(longest line + padding, TEXT_MAX_AUTO_WIDTH_WORLD),
 *   with greedy word wrap beyond the cap.
 * - fixed mode: width = fixedWidth (clamped to the minimum), text wraps.
 * - height = line count × font size × TEXT_LINE_HEIGHT.
 * - explicit newlines are always respected.
 * - the width is never below TEXT_MIN_WIDTH_WORLD (empty text → min width).
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = TEXT_SIZES[size];
  const isFixed = mode === 'fixed' && fixedWidth !== null;
  const maxWidth = isFixed ? Math.max(fixedWidth, TEXT_MIN_WIDTH_WORLD) : TEXT_MAX_AUTO_WIDTH_WORLD;

  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    lines.push(...wrapLine(paragraph, maxWidth, fontPx, measure));
  }

  let longest = 0;
  for (const line of lines) {
    const w = measure(line, fontPx);
    if (w > longest) longest = w;
  }

  let width: number;
  if (isFixed) {
    width = Math.max(fixedWidth, TEXT_MIN_WIDTH_WORLD);
  } else {
    width = Math.min(longest + TEXT_PADDING_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD);
  }
  width = Math.max(width, TEXT_MIN_WIDTH_WORLD);

  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
  return { width, height, lines };
}

/**
 * A measurer backed by a canvas 2d context. In environments without a
 * functional canvas (jsdom, SSR) it falls back to a character-count
 * estimate: length × font size × TEXT_ESTIMATED_GLYPH_RATIO. Never throws.
 */
export function createCanvasMeasurer(fontFamily?: string): Measurer {
  const family = fontFamily ?? TEXT_FONT_FAMILY;
  let ctx: CanvasRenderingContext2D | null = null;
  if (typeof document !== 'undefined') {
    try {
      ctx = document.createElement('canvas').getContext('2d');
    } catch {
      ctx = null;
    }
  }
  if (!ctx) {
    return (text, fontPx) => text.length * fontPx * TEXT_ESTIMATED_GLYPH_RATIO;
  }
  const c = ctx;
  return (text, fontPx) => {
    c.font = `${fontPx}px ${family}`;
    return c.measureText(text).width;
  };
}
