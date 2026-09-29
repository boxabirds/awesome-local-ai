// Text layout and measuring (story 9 `text.layout`).
//
// `layoutText` is the pure maths that decides a text object's box: it wraps lines,
// measures them with an injected `Measurer`, and returns the width/height and the
// wrapped line strings. Keeping it free of Yjs and React means the same function
// runs in a unit test with a fake measurer and in the browser with a canvas one.
//
// `createCanvasMeasurer` builds the real measurer from a canvas 2D context; when no
// canvas exists (the Node unit project, or a browser that refuses one) it falls back
// to an average-glyph-width estimate so the board lays text out roughly instead of
// throwing (error path TC-32).

import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_SIZES,
  TEXT_FONT_FAMILY,
  clamp,
  type TextSize,
} from '../../shared/config.ts';

/** Width, in world units, of `text` rendered at `fontPx`. */
export type Measurer = (text: string, fontPx: number) => number;

/**
 * Average glyph advance as a fraction of the font size, used only when no canvas is
 * available. 0.5 is a reasonable middle for a proportional sans at any size; the
 * estimate only needs to be stable and monotone, not exact.
 */
export const TEXT_FALLBACK_GLYPH_RATIO = 0.5;

/** Round a measured width up to a whole world unit so the last glyph is never cut. */
function ceilUnit(n: number): number {
  return Math.ceil(n - 1e-9);
}

function fontPxOf(size: TextSize): number {
  return TEXT_SIZES[size];
}

/**
 * Greedy word-wrap `line` so each wrapped line is as full as possible without
 * measuring more than `wrapWidth`. A single word wider than `wrapWidth` is placed
 * on its own line and allowed to overflow visually (matching `overflow-wrap`
 * without `anywhere`): the box width stays `wrapWidth`, the word is clipped. This
 * keeps a fixed-width box's height = the number of *words* tall, not character
 * chunks, which is what the design's TC-10 specifies.
 */
function wrapLine(line: string, fontPx: number, wrapWidth: number, measure: Measurer): string[] {
  if (line === '') return [''];
  if (measure(line, fontPx) <= wrapWidth) return [line];

  const out: string[] = [];
  let current = '';
  const words = line.split(' ');
  for (const word of words) {
    if (word === '') continue; // collapse runs of spaces to the joiner below
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current === '') {
      // First word on the line always goes down, even if it alone overflows.
      current = word;
    } else if (measure(candidate, fontPx) <= wrapWidth) {
      current = candidate;
    } else {
      out.push(current);
      current = word;
    }
  }
  if (current !== '' || out.length === 0) out.push(current);
  return out;
}

export interface TextLayout {
  width: number;
  height: number;
  lines: string[];
}

/**
 * Lay out `text` at `size` in `mode`.
 *
 * - **auto**: the box is as wide as the longest wrapped line, capped at
 *   TEXT_MAX_AUTO_WIDTH_WORLD; any source line wider than that wraps (greedy word
 *   wrap, explicit newlines always respected).
 * - **fixed**: the box is exactly `fixedWidth` (clamped to the minimum) and every
 *   line wraps to it.
 *
 * The height is always the number of lines × the font size × TEXT_LINE_HEIGHT, so
 * height follows the content in both modes (text.height).
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = fontPxOf(size);
  const wrapWidth =
    mode === 'fixed'
      ? clamp(fixedWidth ?? TEXT_MIN_WIDTH_WORLD, TEXT_MIN_WIDTH_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD)
      : TEXT_MAX_AUTO_WIDTH_WORLD;

  const source = text.split('\n');
  const lines: string[] = [];
  for (const line of source) {
    for (const wrapped of wrapLine(line, fontPx, wrapWidth, measure)) lines.push(wrapped);
  }

  // Auto width comes from the longest *source* line, capped at the max — so a line
  // that had to wrap still fills the box to the max, not to its wrapped remainder.
  let longest = 0;
  for (const line of source) {
    const w = measure(line, fontPx);
    if (w > longest) longest = w;
  }

  let width: number;
  if (mode === 'fixed') {
    width = wrapWidth;
  } else {
    // Auto: as wide as the longest line, capped, rounded up a hair.
    width = clamp(ceilUnit(longest), TEXT_MIN_WIDTH_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD);
  }
  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
  return { width, height, lines };
}

interface TextMeasureContext {
  font: string;
  measureText(text: string): { width: number };
}

/**
 * A real measurer backed by a canvas 2D context. It is created lazily and caches
 * nothing but the context; the font string is set per call so it always reflects
 * `fontPx`. When no canvas backend exists it returns the character-count estimate.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  let ctx: TextMeasureContext | null | undefined;

  const getContext = (): TextMeasureContext | null => {
    if (ctx !== undefined) return ctx;
    ctx = null;
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        const c = new OffscreenCanvas(1, 1);
        ctx = (c.getContext('2d') as unknown as TextMeasureContext) ?? null;
      } else if (typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        ctx = (c.getContext('2d') as unknown as TextMeasureContext) ?? null;
      }
    } catch {
      ctx = null;
    }
    return ctx;
  };

  const estimate: Measurer = (text, fontPx) =>
    Array.from(text).length * fontPx * TEXT_FALLBACK_GLYPH_RATIO;

  return (text, fontPx) => {
    const context = getContext();
    if (!context || typeof context.measureText !== 'function') return estimate(text, fontPx);
    try {
      context.font = `${fontPx}px ${fontFamily}`;
      const m = context.measureText(text);
      return m ? m.width : estimate(text, fontPx);
    } catch {
      return estimate(text, fontPx);
    }
  };
}
