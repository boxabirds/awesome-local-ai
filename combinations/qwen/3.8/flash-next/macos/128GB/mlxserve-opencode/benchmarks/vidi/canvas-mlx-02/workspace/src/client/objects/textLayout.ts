// The text layout (story 9, text.layout). Framework-free: no React, no DOM
// nodes - the ONLY environmental capability it needs is measuring how wide a
// string is at a font size, which arrives as an injected `TextMeasurer`. That
// is what lets the unit tests check exact arithmetic with a fake measurer
// while the browser uses a canvas.
//
// The rules it implements, from the design:
//  * the box has no horizontal padding: the glyphs reach near to the edge,
//    with TEXT_LAYOUT_PADDING_WORLD of slack so they never touch it;
//  * AUTO width: the box is as wide as its longest line (plus slack), floored
//    at TEXT_MIN_WIDTH_WORLD and capped at TEXT_MAX_AUTO_WIDTH_WORLD; a line
//    that would exceed the cap wraps at it, and a single word that cannot fit
//    breaks mid-word, so no line ever escapes the box;
//  * FIXED width (a side-handle drag): the given width is kept exactly and
//    the text re-wraps inside it;
//  * HEIGHT is always the laid-out line count times the line height - it is
//    computed, never dragged;
//  * everything scales with TEXT_SIZES, not with the zoom.
import {
  DEFAULT_TEXT_SIZE,
  TEXT_FONT_FAMILY,
  TEXT_LAYOUT_PADDING_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_GLYPH_WIDTH_RATIO,
  MAX_OBJECT_SIZE_WORLD,
} from '../../shared/config.ts';
import type { TextSize } from '../../shared/config.ts';

/** Measures one string at one font size, in world units. */
export interface TextMeasurer {
  (text: string, fontPx: number): number;
}

/** The font shorthand a canvas answers the text object's widths with. */
export function canvasFont(fontPx: number): string {
  return `${fontPx}px ${TEXT_FONT_FAMILY}`;
}

/**
 * The shared fallback: average glyph width times length. Positive and
 * proportional to both, which is all the layout needs from a measurer when no
 * canvas exists (and the sanity floor TC-32 checks).
 */
export function estimateTextWidth(text: string, fontPx: number): number {
  return text.length * fontPx * TEXT_GLYPH_WIDTH_RATIO;
}

/**
 * A measurer backed by a 2D canvas, with a small cache. When the environment
 * has no canvas at all (node, jsdom without the canvas package) every answer
 * falls back to `estimateTextWidth`, so the product degrades to an estimate
 * instead of throwing (TC-32).
 */
export function createCanvasMeasurer(): TextMeasurer {
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
  const cache = new Map<string, number>();

  return (text: string, fontPx: number): number => {
    if (text === '') return 0;
    const size = Number.isFinite(fontPx) && fontPx > 0 ? fontPx : TEXT_SIZES[DEFAULT_TEXT_SIZE];
    try {
      if (ctx === undefined) {
        const canvas =
          typeof OffscreenCanvas !== 'undefined'
            ? (new OffscreenCanvas(1, 1) as unknown as OffscreenCanvas)
            : typeof document !== 'undefined'
              ? document.createElement('canvas')
              : null;
        ctx = canvas
          ? ((canvas as unknown as { getContext(k: '2d'): unknown }).getContext('2d') as
              | CanvasRenderingContext2D
              | OffscreenCanvasRenderingContext2D
              | null)
          : null;
      }
      if (ctx) {
        const key = `${size}\u0000${text}`;
        const seen = cache.get(key);
        if (seen !== undefined) return seen;
        ctx.font = canvasFont(size);
        const width = ctx.measureText(text).width;
        cache.set(key, width);
        return width;
      }
    } catch {
      // No canvas to measure with: fall through to the estimate.
    }
    return estimateTextWidth(text, size);
  };
}

// The largest integer prefix length of `word` whose measured width still fits
// `maxWidth` (at least one character always survives, so a line is never empty).
function fitPrefix(word: string, maxWidth: number, fontPx: number, measure: TextMeasurer): number {
  let lo = 1;
  let hi = word.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(word.slice(0, mid), fontPx) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// One paragraph (a stretch between newlines): one line if it fits, greedy
// whole-word lines otherwise, and any word longer than the box broken
// mid-word so no line escapes it.
function wrapParagraph(
  para: string,
  maxWidth: number,
  fontPx: number,
  measure: TextMeasurer,
): string[] {
  if (para === '' || measure(para, fontPx) <= maxWidth) return [para];

  const words = para.split(' ');
  const lines: string[] = [];
  let current = '';
  for (let word of words) {
    // A single word wider than the box: its fitting prefix is a line of its
    // own and the rest starts fresh (an overlong word breaks by character).
    while (word.length > 1 && measure(word, fontPx) > maxWidth) {
      const take = fitPrefix(word, maxWidth, fontPx, measure);
      if (current !== '') {
        lines.push(current);
        current = '';
      }
      lines.push(word.slice(0, take));
      word = word.slice(take);
    }
    const trial = current === '' ? word : `${current} ${word}`;
    if (measure(trial, fontPx) <= maxWidth || current === '') current = trial;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '' || lines.length === 0) lines.push(current);
  return lines;
}

/** Lay `text` out inside `maxWidth`, honouring its explicit newlines. */
export function wrapLines(
  text: string,
  maxWidth: number,
  fontPx: number,
  measure: TextMeasurer,
): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    for (const line of wrapParagraph(para, maxWidth, fontPx, measure)) lines.push(line);
  }
  return lines;
}

/** The line height for a font size, world units. */
export function lineHeightOf(fontPx: number): number {
  return fontPx * TEXT_LINE_HEIGHT;
}

function fontPxOf(size: TextSize | string): number {
  return TEXT_SIZES[size as TextSize] ?? TEXT_SIZES[DEFAULT_TEXT_SIZE];
}

export interface TextLayoutResult {
  width: number;
  height: number;
  /** the laid-out lines; the height is exactly this many lines */
  lines: string[];
}

/**
 * Compute the box for `text`: the whole of text.layout in one call.
 *
 * `widthMode` 'fixed' keeps `fixedWidth` (clamped into
 * [TEXT_MIN_WIDTH_WORLD, MAX_OBJECT_SIZE_WORLD]) and re-wraps the text inside
 * it; 'auto' sizes the box to its longest line, capped at
 * TEXT_MAX_AUTO_WIDTH_WORLD - and the height is always the line count times
 * the line height whatever the mode.
 */
export function layoutText(
  text: string,
  size: TextSize | string,
  widthMode: 'auto' | 'fixed',
  fixedWidth: number | undefined,
  measure: TextMeasurer,
): TextLayoutResult {
  const fontPx = fontPxOf(size);
  const content = typeof text === 'string' ? text : '';

  if (widthMode === 'fixed') {
    const given = Number.isFinite(fixedWidth) ? (fixedWidth as number) : TEXT_MIN_WIDTH_WORLD;
    const width = Math.min(MAX_OBJECT_SIZE_WORLD, Math.max(TEXT_MIN_WIDTH_WORLD, given));
    const lines = wrapLines(content, width, fontPx, measure);
    return { width, height: lines.length * lineHeightOf(fontPx), lines };
  }

  const lines = wrapLines(content, TEXT_MAX_AUTO_WIDTH_WORLD, fontPx, measure);
  let longest = 0;
  for (const line of lines) longest = Math.max(longest, measure(line, fontPx));
  const width = Math.max(
    TEXT_MIN_WIDTH_WORLD,
    Math.min(longest + TEXT_LAYOUT_PADDING_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD),
  );
  return { width, height: lines.length * lineHeightOf(fontPx), lines };
}
