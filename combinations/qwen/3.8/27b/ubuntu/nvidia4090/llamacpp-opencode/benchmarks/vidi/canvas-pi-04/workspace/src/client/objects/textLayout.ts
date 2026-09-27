// Story 9: pure text layout (anchor: text.layout).
//
// The text box is measured with the canvas `measureText` (real fonts decide
// wrapping in the browser). The pure core, `layoutText`, takes the measurer as
// a parameter so it is unit-testable with a deterministic fake (TC-07..TC-11).
// When no 2d canvas is available (jsdom, headless) the measurer falls back to
// an average-glyph-width estimate and never throws (TC-32).
//
// Width rule (design, PRD "as wide as the longest line"): in auto mode the box
// width is the longest ORIGINAL line clamped to TEXT_MAX_AUTO_WIDTH_WORLD; in
// fixed mode it is the stored (clamped) fixed width. Each original line wraps
// greedily at min(lineWidth, max) so the wrapped lines always fit the box.

import {
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';
import type { TextWidthMode } from '../../shared/objects/text';

/** Measure a string's width in world units at a font size in world px. */
export type Measurer = (text: string, fontPx: number) => number;

export interface TextLayout {
  width: number;
  height: number;
  lines: string[];
}

/**
 * Average glyph width as a fraction of the font size, used when the canvas is
 * unavailable (jsdom, or a browser without a 2d context). Named setting per
 * the design ("the fallback: length * fontPx * AVERAGE_GLYPH_WIDTH").
 */
export const AVERAGE_GLYPH_WIDTH = 0.6;

function estimate(text: string, fontPx: number): number {
  return text.length * fontPx * AVERAGE_GLYPH_WIDTH;
}

/** Structural shape of a 2d context's text API (both canvas flavors). */
interface TextMeasuringContext {
  font: string;
  measureText(text: string): { width: number };
}

function acquireContext(fontFamily: string): TextMeasuringContext | null {
  try {
    const g = globalThis as {
      OffscreenCanvas?: new (width: number, height: number) => {
        getContext(kind: '2d'): unknown;
      };
      document?: {
        createElement(tag: string): {
          getContext(kind: '2d'): unknown;
        };
      };
      navigator?: { userAgent?: string };
    };
    if (typeof g.OffscreenCanvas === 'function') {
      const ctx = new g.OffscreenCanvas(1, 1).getContext('2d');
      if (ctx !== null && ctx !== undefined) {
        const text = ctx as unknown as TextMeasuringContext;
        text.font = `16px ${fontFamily}`;
        return text;
      }
    }
    // jsdom's canvas getContext is 'not implemented' and logs a virtual-
    // console error before throwing; skip it (the estimate is the jsdom path).
    const ua = typeof g.navigator?.userAgent === 'string' ? g.navigator.userAgent : '';
    if (ua.includes('jsdom')) return null;
    if (typeof g.document !== 'undefined' && g.document !== null) {
      const ctx = g.document.createElement('canvas').getContext('2d');
      if (ctx !== null && ctx !== undefined) {
        const text = ctx as unknown as TextMeasuringContext;
        text.font = `16px ${fontFamily}`;
        return text;
      }
    }
  } catch {
    // Fall through to the estimate; layout must never throw (TC-32).
  }
  return null;
}

/**
 * A Measurer backed by the canvas `measureText` (design: "the text box is
 * measured with canvas measureText"). Falls back to the character-count
 * estimate when no 2d context is available; never throws (TC-32).
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  const ctx = acquireContext(fontFamily);
  if (ctx === null) return estimate;
  return (text, fontPx) => {
    ctx.font = `${fontPx}px ${fontFamily}`;
    return ctx.measureText(text).width;
  };
}

let shared: Measurer | null = null;

/** One shared measurer for the client (avoids one canvas per component). */
export function sharedMeasurer(): Measurer {
  if (shared === null) shared = createCanvasMeasurer();
  return shared;
}

/**
 * Greedy word wrap of one (already newline-split) line at `maxWidth`. Words
 * are separated by single spaces; consecutive spaces are preserved inside a
 * line. A single word wider than `maxWidth` takes its own line (no mid-word
 * splitting). An empty line yields one empty line.
 */
function wrapLine(
  line: string,
  maxWidth: number,
  fontPx: number,
  measure: Measurer,
): string[] {
  if (line === '') return [''];
  const words = line.split(' ');
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    if (current === '') {
      current = word;
      continue;
    }
    const candidate = current + ' ' + word;
    if (measure(candidate, fontPx) <= maxWidth) {
      current = candidate;
    } else {
      out.push(current);
      current = word;
    }
  }
  out.push(current);
  return out;
}

/**
 * Compute the box for `text` at preset `size`: in auto mode the width is the
 * longest original line clamped to TEXT_MAX_AUTO_WIDTH_WORLD, in fixed mode
 * the stored width clamped to at least TEXT_MIN_WIDTH_WORLD. The height is the
 * number of wrapped lines times the line height. Pure: no DOM, no doc.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: TextWidthMode,
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = TEXT_SIZES[size];
  const fixedActive =
    mode === 'fixed' && fixedWidth !== null && Number.isFinite(fixedWidth) && fixedWidth > 0;
  const fixedClamped = fixedActive ? Math.max(fixedWidth, TEXT_MIN_WIDTH_WORLD) : 0;

  const lines: string[] = [];
  let longestRaw = 0;
  for (const raw of text.split('\n')) {
    const rawWidth = measure(raw, fontPx);
    if (rawWidth > longestRaw) longestRaw = rawWidth;
    const wrapWidth = fixedActive
      ? fixedClamped
      : Math.min(rawWidth, TEXT_MAX_AUTO_WIDTH_WORLD);
    lines.push(...wrapLine(raw, wrapWidth, fontPx, measure));
  }

  const width =
    text === ''
      ? TEXT_MIN_WIDTH_WORLD // keep the box clickable while empty
      : fixedActive
        ? fixedClamped
        : Math.min(longestRaw, TEXT_MAX_AUTO_WIDTH_WORLD);

  return {
    width,
    height: lines.length * fontPx * TEXT_LINE_HEIGHT,
    lines,
  };
}
