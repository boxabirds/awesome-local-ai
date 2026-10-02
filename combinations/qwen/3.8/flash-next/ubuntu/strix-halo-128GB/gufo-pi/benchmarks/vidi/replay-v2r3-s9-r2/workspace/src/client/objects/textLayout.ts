/**
 * Pure text layout for text objects (story 9).
 *
 * The board stores every object's box, so the client that changed the text
 * measures it and writes the result. Measuring lives behind a `Measurer`
 * function: a canvas in the browser, a deterministic fake in tests, and a
 * character-count estimate when neither is available (never a throw).
 *
 * Height always follows the content (`text.height`); there is no vertical
 * resize for text.
 */
import type { TextSize } from '../../shared/config';
import {
  TEXT_AUTO_WIDTH_PADDING_WORLD,
  TEXT_AVG_GLYPH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../shared/config';

/** Width of `text` in world units when drawn at `fontPx` world units. */
export type Measurer = (text: string, fontPx: number) => number;

export interface TextLayout {
  width: number;
  height: number;
  lines: string[];
}

/**
 * Fallback width used when no canvas is available: the average glyph width is
 * `TEXT_AVG_GLYPH_RATIO` of the font size. Rough, but it keeps boxes usable
 * instead of throwing.
 */
export function estimateTextWidth(text: string, fontPx: number): number {
  let glyphs = 0;
  for (const _char of text) glyphs += 1;
  return glyphs * fontPx * TEXT_AVG_GLYPH_RATIO;
}

type Ctx2D = {
  font: string;
  measureText(text: string): { width: number };
};

/**
 * A measurer backed by a 2D canvas. Falls back to `estimateTextWidth` for the
 * whole lifetime of the measurer when no canvas (or no 2D context) exists, so
 * server-side rendering, jsdom and restricted browsers all keep working.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  let ctx: Ctx2D | null | undefined; // undefined = not attempted yet
  let attempted = false;

  const acquire = (): Ctx2D | null => {
    if (attempted) return ctx ?? null;
    attempted = true;
    ctx = null;
    try {
      const Offscreen = (globalThis as { OffscreenCanvas?: new (w: number, h: number) => any })
        .OffscreenCanvas;
      if (typeof Offscreen === 'function') {
        const canvas = new Offscreen(1, 1);
        const c = canvas.getContext('2d');
        if (c && typeof c.measureText === 'function') ctx = c as Ctx2D;
      }
    } catch {
      /* try the DOM next */
    }
    if (ctx) return ctx;
    try {
      const doc = (globalThis as { document?: { createElement(tag: string): any } }).document;
      const el = doc?.createElement?.('canvas');
      const c = el?.getContext?.('2d');
      if (c && typeof c.measureText === 'function') ctx = c as Ctx2D;
    } catch {
      /* no canvas at all: the estimate is used */
    }
    return ctx ?? null;
  };

  return (text: string, fontPx: number): number => {
    const c = acquire();
    if (c) {
      try {
        c.font = `${fontPx}px ${fontFamily}`;
        const width = c.measureText(text).width;
        if (Number.isFinite(width) && width >= 0) return width;
      } catch {
        /* fall through to the estimate */
      }
    }
    return estimateTextWidth(text, fontPx);
  };
}

/** Greedy word wrap: a word wider than `avail` still gets a line of its own. */
function wrapLine(line: string, avail: number, fontPx: number, measure: Measurer): string[] {
  if (line === '') return [''];
  if (measure(line, fontPx) <= avail) return [line];

  const out: string[] = [];
  let current = '';
  for (const word of line.split(' ')) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current === '' || measure(candidate, fontPx) <= avail) {
      current = candidate;
    } else {
      out.push(current);
      current = word;
    }
  }
  if (current !== '') out.push(current);
  return out.length > 0 ? out : [''];
}

/**
 * The box a text object needs:
 *  - `auto`:  width = longest line (+ padding) up to TEXT_MAX_AUTO_WIDTH_WORLD,
 *             longer lines wrap greedily at that width;
 *  - `fixed`: width = the fixed width (never below TEXT_MIN_WIDTH_WORLD), text
 *             rewraps to it;
 *  - height  = rendered lines × font size × TEXT_LINE_HEIGHT, so height always
 *             follows the content. Explicit newlines are always respected.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = TEXT_SIZES[size] ?? TEXT_SIZES.M;
  const source = text.length === 0 ? [''] : text.split('\n');

  if (mode === 'fixed') {
    const width = Math.max(
      TEXT_MIN_WIDTH_WORLD,
      typeof fixedWidth === 'number' && Number.isFinite(fixedWidth)
        ? fixedWidth
        : TEXT_MIN_WIDTH_WORLD,
    );
    const lines = source.flatMap((line) => wrapLine(line, width, fontPx, measure));
    return { width, height: lines.length * fontPx * TEXT_LINE_HEIGHT, lines };
  }

  let longest = 0;
  for (const line of source) {
    const w = measure(line, fontPx);
    if (w > longest) longest = w;
  }

  if (longest <= TEXT_MAX_AUTO_WIDTH_WORLD) {
    return {
      width: Math.min(longest + TEXT_AUTO_WIDTH_PADDING_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD),
      height: source.length * fontPx * TEXT_LINE_HEIGHT,
      lines: source,
    };
  }

  const lines = source.flatMap((line) =>
    wrapLine(line, TEXT_MAX_AUTO_WIDTH_WORLD, fontPx, measure),
  );
  return {
    width: TEXT_MAX_AUTO_WIDTH_WORLD,
    height: lines.length * fontPx * TEXT_LINE_HEIGHT,
    lines,
  };
}
