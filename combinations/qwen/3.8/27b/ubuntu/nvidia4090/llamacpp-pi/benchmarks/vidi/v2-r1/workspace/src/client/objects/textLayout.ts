// Text layout (story 9, text.layout). Pure measurement math: given the text
// content, its size preset and width mode, compute the box (width, height)
// the object should persist.
//
// Width rule (text.grow_wrap / text.fixed_width):
//   - auto:  width = min(longest line, TEXT_MAX_AUTO_WIDTH_WORLD); lines
//            longer than the wrap limit are word-wrapped greedily.
//   - fixed: width = fixedWidth (the handle-set value); wrapping at the same
//            fixed width.
// Height: number of (wrapped) lines x font size x TEXT_LINE_HEIGHT.
//
// The wrap budget equals the wrap limit (auto) or the fixed width: the
// rendered text uses no horizontal padding, so the measured and the
// on-screen wrapping agree.

import {
  TEXT_ESTIMATED_GLYPH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_FONT_FAMILY,
  type TextSize,
} from '../../shared/config';

/** Measures the width (world units) of `text` rendered at `fontPx`. */
export type Measurer = (text: string, fontPx: number) => number;

export interface TextLayout {
  width: number;
  height: number;
  /** The wrapped lines (for tests and debugging). */
  lines: string[];
}

/** Word-wrap `line` greedily into lines that measure at most `budget`. */
function wrapLine(line: string, budget: number, measure: (s: string) => number): string[] {
  if (line === '' || measure(line) <= budget) return [line];
  const words = line.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current === '' || measure(candidate) <= budget) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

/**
 * Compute the layout of `text` at size preset `size`.
 *
 * @param text the full text content (may contain explicit newlines)
 * @param size the size preset (font size looked up in TEXT_SIZES)
 * @param widthMode 'auto' grows to the content up to the wrap limit;
 *   'fixed' uses `fixedWidth`
 * @param fixedWidth the stored fixed width (required when widthMode is 'fixed')
 * @param measure a width measurer; pass a deterministic one in tests
 */
export function layoutText(
  text: string,
  size: TextSize,
  widthMode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = TEXT_SIZES[size];
  const budget =
    widthMode === 'fixed'
      ? Math.max(0, fixedWidth ?? 0)
      : TEXT_MAX_AUTO_WIDTH_WORLD;

  const measureAt = (s: string): number => measure(s, fontPx);

  const lines: string[] = [];
  let longest = 0;
  for (const rawLine of text.split('\n')) {
    longest = Math.max(longest, measureAt(rawLine));
    const wrapped = wrapLine(rawLine, budget, measureAt);
    for (const line of wrapped) lines.push(line);
  }
  if (lines.length === 0) lines.push('');

  const width =
    widthMode === 'fixed'
      ? Math.max(0, fixedWidth ?? 0)
      : Math.min(longest, TEXT_MAX_AUTO_WIDTH_WORLD);
  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
  return { width, height, lines };
}

/**
 * A measurer backed by the canvas 2D API (real font metrics in browsers).
 * Falls back to a character-count estimate when no 2D context is available
 * (unit tests / jsdom): width = char count x fontPx x TEXT_ESTIMATED_GLYPH_RATIO.
 * The fallback never throws.
 */
export function createCanvasMeasurer(fontFamily?: string): Measurer {
  const family = fontFamily ?? TEXT_FONT_FAMILY;
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      ctx = new OffscreenCanvas(1, 1).getContext('2d');
    } else if (typeof document !== 'undefined') {
      ctx = document.createElement('canvas').getContext('2d');
    }
  } catch {
    ctx = null;
  }
  if (ctx === null) {
    return (text, fontPx) => text.length * fontPx * TEXT_ESTIMATED_GLYPH_RATIO;
  }
  return (text, fontPx) => {
    ctx.font = `${fontPx}px ${family}`;
    return ctx.measureText(text).width;
  };
}
