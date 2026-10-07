import {
  TEXT_AVG_GLYPH_WIDTH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

// ---------------------------------------------------------------------------
// Text layout (story 9). Wrapping and height are computed from **measured**
// glyphs, never from a characters-per-line rule: the same sentence occupies
// different widths in different fonts, and a guess would wrap in the wrong place
// (design key decision 4). The measure is injected, so the tests are
// deterministic without loading fonts.
//
// `width` is always either the longest line (auto mode) or the fixed width the
// person dragged to; `height` is always `lines × size × TEXT_LINE_HEIGHT`, so the
// height can never disagree with the content that is stored.
// ---------------------------------------------------------------------------

/** Width of `text` in board units at `fontPx`. */
export type Measurer = (text: string, fontPx: number) => number;

/** The box a piece of text needs at a given size and width mode. */
export interface TextLayout {
  readonly width: number;
  readonly height: number;
  readonly lines: number;
}

/** Round to two decimals: stored boxes stay small and compare equal across peers. */
const round = (n: number): number => Math.round(n * 100) / 100;
/** Two decimals, never below the value — see the automatic width in `layoutText`. */
const ceil = (n: number): number => Math.ceil(n * 100) / 100;

/** Fallback when there is no canvas to measure with (jsdom, a worker). */
export const estimateMeasurer: Measurer = (text, fontPx) =>
  text.length * fontPx * TEXT_AVG_GLYPH_WIDTH_RATIO;

/** Widest line we ever measure; longer strings are cut here, not measured whole. */
const MAX_MEASURED_CHARS = 4096;

/**
 * A `Measurer` backed by the canvas 2D text metrics — the same font engine the
 * DOM uses for layout, so a line fits in the box we store for it. Falls back to
 * `estimateMeasurer` where no canvas exists (jsdom).
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  let measure: ((text: string, fontPx: number) => number) | null = null;
  try {
    const canvas: HTMLCanvasElement | OffscreenCanvas | null =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1)
        : typeof document !== 'undefined'
          ? document.createElement('canvas')
          : null;
    const ctx = canvas
      ? (canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null)
      : null;
    if (ctx) {
      const cache = new Map<string, number>();
      measure = (text, fontPx) => {
        if (text === '') return 0;
        const cut = text.length > MAX_MEASURED_CHARS ? text.slice(0, MAX_MEASURED_CHARS) : text;
        const cacheable = cut.length <= 64; // short lines repeat while typing; long ones do not
        const key = `${fontPx}\u0000${cut}`;
        if (cacheable) {
          const hit = cache.get(key);
          if (hit !== undefined) return hit;
        }
        ctx.font = `${fontPx}px ${fontFamily}`;
        const width = ctx.measureText(cut).width;
        if (cacheable) {
          if (cache.size > 2_000) cache.clear(); // never grow without bound
          cache.set(key, width);
        }
        return width;
      };
    }
  } catch {
    measure = null; // no canvas in this environment
  }
  return measure ?? estimateMeasurer;
}

let shared: Measurer | null = null;

/**
 * The measurer every text object on this client shares: one canvas, one cache,
 * built the first time a box has to be measured (and in an environment without a
 * canvas, one fallback for everybody).
 */
export function sharedMeasurer(): Measurer {
  if (!shared) {
    // Built on first measurement, not when a board is merely opened: an environment
    // without a canvas is asked only once a text actually needs measuring.
    const built: { current?: Measurer } = {};
    shared = (text, fontPx) => (built.current ??= createCanvasMeasurer())(text, fontPx);
  }
  return shared;
}

/** Break one over-long line into lines no wider than `available`. */
function wrapLine(line: string, fontPx: number, available: number, measure: Measurer): string[] {
  if (line === '' || measure(line, fontPx) <= available) return [line];

  const out: string[] = [];
  let current = '';
  // Tokens are words and the whitespace runs between them, so a wrapped line keeps
  // its inner spacing and we never wrap in the middle of a word.
  for (const token of line.split(/(\s+)/)) {
    if (token === '') continue;
    if (measure(current + token, fontPx) <= available || current === '') {
      // A lone word wider than the box still has to be broken, or it would overflow.
      if (current === '' && measure(token, fontPx) > available && !/^\s/.test(token)) {
        let rest = token;
        while (measure(rest, fontPx) > available && rest.length > 1) {
          let keep = 1;
          while (keep < rest.length && measure(rest.slice(0, keep + 1), fontPx) <= available) keep++;
          out.push(rest.slice(0, keep));
          rest = rest.slice(keep);
        }
        current = rest;
        continue;
      }
      current += token;
      continue;
    }
    out.push(current);
    // Leading whitespace of a wrapped line would be a phantom indent.
    current = /^\s/.test(token) ? token.replace(/^\s+/, '') : token;
  }
  if (current !== '') out.push(current);
  return out.length > 0 ? out : [''];
}

/**
 * The box for `text`: the four size presets pick the font size, `widthMode`
 * decides the width, and the height is always `lines × size × TEXT_LINE_HEIGHT`.
 *
 * - `auto` (PRD text.auto_width): the width is the longest line, but never wider
 *   than TEXT_MAX_AUTO_WIDTH_WORLD — so typing grows the box sideways until the
 *   limit, then it grows downwards. A line wider than the limit is broken
 *   greedily at word boundaries.
 * - `fixed` (PRD text.fixed_width): the width is whatever the person dragged to
 *   (never below TEXT_MIN_WIDTH_WORLD) and only the height changes.
 *
 * Empty text still occupies one line, and never reports a width of 0, so
 * selection bounds stay finite.
 */
export function layoutText(
  text: string,
  size: TextSize,
  widthMode: 'auto' | 'fixed' = 'auto',
  fixedWidth = 0,
  measure: Measurer = estimateMeasurer,
): TextLayout {
  const fontPx = TEXT_SIZES[size] ?? TEXT_SIZES.M;
  const source = text.split('\n');
  const widths = source.map((line) => measure(line, fontPx));

  let boxWidth: number;
  if (widthMode === 'fixed') {
    // The width a person dragged to is taken exactly as they dragged it.
    boxWidth = round(Math.max(Number.isFinite(fixedWidth) ? fixedWidth : 0, TEXT_MIN_WIDTH_WORLD));
  } else {
    // Rounded *up*, so a box is never a hair narrower than the line it holds: the
    // browser wraps at this same width, and a box shorter than its own line would
    // paint that line on two rows.
    const longest = widths.reduce((a, b) => (b > a ? b : a), 0);
    boxWidth = ceil(Math.min(Math.max(longest, TEXT_MIN_WIDTH_WORLD), TEXT_MAX_AUTO_WIDTH_WORLD));
  }

  const lines = source.flatMap((line) => wrapLine(line, fontPx, boxWidth, measure));

  return {
    width: boxWidth,
    height: round(lines.length * fontPx * TEXT_LINE_HEIGHT),
    lines: lines.length,
  };
}

/** The line boxes a text object holds at its size — used by the renderer. */
export function lineHeightPx(size: TextSize): number {
  return (TEXT_SIZES[size] ?? TEXT_SIZES.M) * TEXT_LINE_HEIGHT;
}
