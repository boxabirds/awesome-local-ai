/**
 * Text layout for free text objects (story 9, text.wrap / text.sizes):
 * the pure "grow-then-wrap" algorithm, a pluggable measurer, and the
 * production canvas measurer (with an estimation fallback for
 * environments without 2d context measurement, TC-32).
 *
 * Layout rules:
 * - A text object's height always equals its content:
 *   `lines x TEXT_SIZES[size] x TEXT_LINE_HEIGHT`.
 * - Auto width: the box grows with the longest line up to
 *   TEXT_MAX_AUTO_WIDTH_WORLD; a line longer than that wraps into as many
 *   lines as needed (text.wrap, text.fixed_width).
 * - Fixed width: text always wraps at the set width.
 * - The wrap is word-based (greedy) and mirrors the CSS the object renders
 *   with (white-space: pre-wrap), so what the browser shows is what the
 *   layout computed: the stored box never needs a second re-wrap.
 *
 * The measurer takes (text, fontPx) and returns the width in world units.
 * Layout is measured in the world layer's local units, so it is
 * zoom-independent.
 */

import {
  TEXT_ESTIMATED_GLYPH_WIDTH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/** Measures a string at a font size; returns width in world units. */
export type Measurer = (text: string, fontPx: number) => number;

/** Result of layoutText: the stored box + the wrapped lines (diagnostics). */
export interface TextLayout {
  /** Box width in world units (auto: grow-then-wrap; fixed: the set width). */
  width: number;
  /** Box height in world units: lines x size x TEXT_LINE_HEIGHT. */
  height: number;
  /** The wrapped lines (one entry per rendered line, empty lines included). */
  lines: string[];
}

/**
 * Average-glyph estimate of a string's width. Used when canvas measurement
 * is unavailable (unit tests, workers) — deterministic and proportional to
 * the font size (TC-32).
 */
export function estimateTextWidth(text: string, fontPx: number): number {
  return text.length * fontPx * TEXT_ESTIMATED_GLYPH_WIDTH_RATIO;
}

/** A minimal 2d context: just enough to set a font and measure text. */
interface TextMeasureContext {
  font: string;
  measureText(text: string): { width: number };
}

function makeMeasureContext(): TextMeasureContext | null {
  if (typeof document !== 'undefined') {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx !== null) {
      return ctx;
    }
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    const ctx = new OffscreenCanvas(8, 8).getContext('2d');
    if (ctx !== null) {
      return ctx;
    }
  }
  return null;
}

/**
 * Production measurer: canvas `measureText` at the object's font
 * (`${fontPx}px` TEXT_FONT_FAMILY). Falls back to the average-glyph
 * estimate when no 2d context is available (unit tests / non-DOM) instead
 * of throwing (TC-32).
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  const ctx = makeMeasureContext();
  if (ctx === null) {
    return (text, fontPx) => estimateTextWidth(text, fontPx);
  }
  return (text: string, fontPx: number): number => {
    ctx.font = `${fontPx}px ${fontFamily}`;
    const width = ctx.measureText(text).width;
    return Number.isFinite(width) && width >= 0 ? width : estimateTextWidth(text, fontPx);
  };
}

/**
 * The client-wide measurer (one canvas 2d context per client), created
 * lazily so importing this module never touches document/canvas.
 */
let sharedMeasurer: Measurer | null = null;

export function getMeasurer(): Measurer {
  if (sharedMeasurer === null) {
    sharedMeasurer = createCanvasMeasurer();
  }
  return sharedMeasurer;
}

/**
 * Greedy word wrap of one paragraph at `maxWidth`. An empty paragraph
 * yields one empty line; a single word wider than `maxWidth` stays on its
 * own line (it overflows rather than breaking mid-word — the same behaviour
 * as the rendered text).
 */
function wrapParagraph(
  paragraph: string,
  maxWidth: number,
  fontPx: number,
  measure: Measurer,
): string[] {
  if (paragraph === '') {
    return [''];
  }
  const words = paragraph.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current !== '' && measure(candidate, fontPx) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines;
}

/**
 * Computes the layout box for `text` at size `size` in `mode`:
 *
 * - mode 'auto': width = the longest pre-wrap line measured at the size,
 *   capped at TEXT_MAX_AUTO_WIDTH_WORLD (grow-then-wrap); wrapping happens
 *   at the cap.
 * - mode 'fixed': width = `fixedWidth` (the stored width); wrapping happens
 *   at that width.
 *
 * height = number of lines x TEXT_SIZES[size] x TEXT_LINE_HEIGHT.
 * Empty text: zero width, one line of height (the caret still has a line).
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = TEXT_SIZES[size];
  const lineHeight = fontPx * TEXT_LINE_HEIGHT;

  const wrapAt =
    mode === 'fixed' && fixedWidth !== null && Number.isFinite(fixedWidth) && fixedWidth > 0
      ? fixedWidth
      : TEXT_MAX_AUTO_WIDTH_WORLD;

  const lines: string[] = [];
  let longest = 0;
  for (const paragraph of text.split('\n')) {
    if (paragraph !== '') {
      // "Longest line" for the auto width is the longest PRE-WRAP line.
      longest = Math.max(longest, measure(paragraph, fontPx));
    }
    for (const line of wrapParagraph(paragraph, wrapAt, fontPx, measure)) {
      lines.push(line);
    }
  }

  const width =
    lines.length === 0
      ? 0
      : mode === 'fixed' && fixedWidth !== null && Number.isFinite(fixedWidth) && fixedWidth > 0
        ? fixedWidth
        : Math.min(longest, TEXT_MAX_AUTO_WIDTH_WORLD);

  return { width, height: lines.length * lineHeight, lines };
}
