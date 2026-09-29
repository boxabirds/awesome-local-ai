// Pure text layout (story 9, text.layout): word-wrapping and box
// measurement for text objects. No DOM, no React, no Yjs — the measurer is
// injected (canvas in the browser, estimate elsewhere), so the maths is
// deterministic in unit tests.
//
// Box model:
// - auto mode: a line longer than TEXT_MAX_AUTO_WIDTH_WORLD wraps greedily
//   at word boundaries to fit the inner width (max − 2× padding); the box is
//   exactly TEXT_MAX_AUTO_WIDTH_WORLD wide. Shorter text is as wide as its
//   longest line plus 2× padding, capped at the max (text.auto_width).
// - fixed mode: the box is exactly fixedWidth wide; lines wrap at the inner
//   width (fixed − 2× padding) (text.fixed_width).
// - height always follows the content: lines × size × TEXT_LINE_HEIGHT
//   (text.height). A single word longer than the limit takes its own line
//   (overflow, never split) like CSS pre-wrap.

import {
  TEXT_GLYPH_WIDTH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_PADDING_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/** Measures the rendered width (world units) of `text` at font size `fontPx`. */
export type Measurer = (text: string, fontPx: number) => number;

/** Character-count estimate: average glyph width as a named fraction of the
 *  font size. The fallback when no canvas is available (jsdom, workers). */
export const estimateMeasurer: Measurer = (text, fontPx) =>
  text.length * fontPx * TEXT_GLYPH_WIDTH_RATIO;

/** The measurer only needs `font` + `measureText` (shared by canvas and
 *  OffscreenCanvas 2D contexts). */
interface TextMeasureContext {
  font: string;
  measureText(text: string): { width: number };
}

let canvasCtx: TextMeasureContext | null | undefined; // undefined = unknown

function getCanvasContext(): TextMeasureContext | null {
  if (canvasCtx !== undefined) return canvasCtx;
  canvasCtx = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      canvasCtx = new OffscreenCanvas(8, 8).getContext('2d') ?? null;
    } else if (typeof document !== 'undefined') {
      canvasCtx = document.createElement('canvas').getContext('2d') ?? null;
    }
  } catch {
    canvasCtx = null;
  }
  return canvasCtx;
}

/**
 * A canvas-backed measurer (browser): measureText at the given font size
 * with the board's standard font family. Falls back to the character-count
 * estimate when no canvas is available — never throws.
 */
export function createCanvasMeasurer(fontFamily: string = 'Inter, system-ui, sans-serif'): Measurer {
  const ctx = getCanvasContext();
  if (ctx === null) return estimateMeasurer;
  return (text, fontPx) => {
    if (text === '') return 0;
    ctx.font = `${fontPx}px ${fontFamily}`;
    return ctx.measureText(text).width;
  };
}

export interface TextLayout {
  /** Box width in world units (auto: longest line up to the max, fixed:
   *  the fixed width). */
  width: number;
  /** Box height: line count × size × TEXT_LINE_HEIGHT (always content). */
  height: number;
  /** The wrapped lines (explicit newlines respected). */
  lines: string[];
}

/** Greedy word wrap of `line` to fit `limit` (world units). Never splits a
 *  word: an over-long word takes its own (overflowing) line. */
function wrapLine(line: string, limit: number | null, measure: Measurer, fontPx: number): string[] {
  if (limit === null) return [line];
  if (line === '' || measure(line, fontPx) <= limit) return [line];
  const out: string[] = [];
  let current = '';
  for (const word of line.split(' ')) {
    if (word === '') continue; // collapse consecutive/edge spaces
    if (current === '') {
      current = word;
      continue;
    }
    const candidate = `${current} ${word}`;
    if (measure(candidate, fontPx) <= limit) {
      current = candidate;
    } else {
      out.push(current);
      current = word;
    }
  }
  out.push(current === '' ? line : current);
  return out;
}

/**
 * Lays out `text` at preset `size`:
 * - auto mode: width = longest line up to TEXT_MAX_AUTO_WIDTH_WORLD, lines
 *   longer than the max wrap greedily at word boundaries;
 * - fixed mode: width = fixedWidth (clamped to at least
 *   TEXT_MIN_WIDTH_WORLD), lines wrap at the fixed width.
 * Height always follows the content (text.height).
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = TEXT_SIZES[size];
  const lines: string[] = [];
  let wrapped = false;
  for (const rawLine of text.split('\n')) {
    if (mode === 'fixed') {
      const inner = Math.max((fixedWidth ?? TEXT_MIN_WIDTH_WORLD) - 2 * TEXT_PADDING_WORLD, 0);
      const parts = wrapLine(rawLine, inner, measure, fontPx);
      if (parts.length > 1) wrapped = true;
      lines.push(...parts);
    } else {
      const overMax = measure(rawLine, fontPx) > TEXT_MAX_AUTO_WIDTH_WORLD;
      const inner = overMax
        ? TEXT_MAX_AUTO_WIDTH_WORLD - 2 * TEXT_PADDING_WORLD
        : null;
      const parts = wrapLine(rawLine, inner, measure, fontPx);
      if (parts.length > 1) wrapped = true;
      lines.push(...parts);
    }
  }
  if (lines.length === 0) lines.push('');

  let longest = 0;
  for (const line of lines) {
    const width = measure(line, fontPx);
    if (width > longest) longest = width;
  }

  let width: number;
  if (mode === 'fixed') {
    width = Math.max(fixedWidth ?? TEXT_MIN_WIDTH_WORLD, TEXT_MIN_WIDTH_WORLD);
  } else if (wrapped) {
    width = TEXT_MAX_AUTO_WIDTH_WORLD;
  } else {
    width = Math.min(longest + 2 * TEXT_PADDING_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD);
  }

  return { width, height: lines.length * fontPx * TEXT_LINE_HEIGHT, lines };
}
