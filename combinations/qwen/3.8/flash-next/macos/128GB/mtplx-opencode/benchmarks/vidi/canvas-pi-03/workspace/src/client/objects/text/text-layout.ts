/**
 * Text layout for the free-text object (story 9) — design
 * `whiteboard/src/objects/text/layout.ts`.
 *
 * The box of a text block is measured, never guessed: the same font the editor
 * renders in and the canvas draws with is handed to a measurer, and the box
 * follows those measurements. Everything here is pure and takes the measurer as
 * an argument, so the wrapping rules are unit-testable with a fake measurer and
 * no DOM at all.
 */

import {
  MAX_OBJECT_SIZE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_PADDING_WORLD,
  TEXT_SIZES,
  TEXT_FONT_FAMILY,
  TEXT_AVG_GLYPH_RATIO,
  type TextSize,
} from '../../../shared/config';

/** A font as the layout needs it: a token, a size and a family. */
export interface FontSpec {
  /** Size token, e.g. `'text-md'` — part of every layout cache key. */
  token: string;
  /** Font size in world units. */
  size: number;
  /** Font family; a different family measures differently. */
  family: string;
  /** Line height in world units (size × TEXT_LINE_HEIGHT). */
  lineHeight: number;
}

/** A function that returns the width of `text` when drawn in `font`. */
export type Measurer = (text: string, font: FontSpec) => number;

/** Shared line-height ratio for every text size. */
export const LINE_HEIGHT = TEXT_LINE_HEIGHT;

/** Inner padding of a text block: added to the measured line width on both
 * sides, and to the stacked lines above and below. */
export const TEXT_PADDING = { x: TEXT_PADDING_WORLD, y: TEXT_PADDING_WORLD };

/** Smallest box a text block may have, in world units. */
export const MIN_BLOCK_SIZE = { width: TEXT_MIN_WIDTH_WORLD, height: 20 };

/** Font spec for one of the four size steps. */
export function fontSpec(size: TextSize | string): FontSpec {
  const px = TEXT_SIZES[size as TextSize] ?? TEXT_SIZES.M;
  return { token: `text-${String(size).toLowerCase()}`, size: px, family: TEXT_FONT_FAMILY, lineHeight: px * LINE_HEIGHT };
}

/** The font a new block starts in. */
export const DEFAULT_FONT = fontSpec('M');

/**
 * Width of a line measured in `font`. With a real canvas this is the measured
 * width; without one it is the proportional estimate below — never a flat 6 px
 * per character, which made every long line fit on one row.
 */
export function measureWidth(text: string, font: FontSpec, measure: Measurer): number {
  if (text.length === 0) return 0;
  return measure(text, font);
}

/** Fallback advance of one character: proportional to the font size, so a
 * narrow string and a wide one are not the same width. */
export function estimateWidth(text: string, font: FontSpec): number {
  return text.length * font.size * TEXT_AVG_GLYPH_RATIO;
}

/**
 * Greedy wrap of one hard line into lines no wider than `width`. A word wider
 * than the box is broken (a long URL must not grow the block forever); a line
 * that already fits is returned untouched, and empty input yields one empty
 * line so the block still has a height.
 */
export function wrapLine(text: string, width: number, font: FontSpec, measure: Measurer): string[] {
  if (text.length === 0) return [''];
  if (width <= 0) return [text];
  if (measure(text, font) <= width) return [text];

  const out: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    if (current.length === 0) {
      current = word;
    } else if (measure(`${current} ${word}`, font) <= width) {
      current = `${current} ${word}`;
    } else {
      out.push(current);
      current = word;
    }
    // A single word wider than the box is broken character by character.
    while (current.length > 1 && measure(current, font) > width) {
      let cut = current.length;
      while (cut > 1 && measure(current.slice(0, cut), font) > width) cut -= 1;
      if (cut >= current.length) cut = current.length - 1;
      out.push(current.slice(0, cut));
      current = current.slice(cut);
    }
  }
  out.push(current);
  return out;
}

/** Every hard line of `text`, wrapped. */
function wrapText(text: string, width: number, font: FontSpec, measure: Measurer): string[] {
  const lines: string[] = [];
  for (const line of text.split('\n')) lines.push(...wrapLine(line, width, font, measure));
  return lines;
}

/** What a block needs to draw `lines` at `font`. */
export function boxHeight(lineCount: number, font: FontSpec): number {
  return Math.max(MIN_BLOCK_SIZE.height, Math.ceil(lineCount * font.lineHeight) + TEXT_PADDING.y * 2);
}

/** The footprint and the drawn lines of a text block. */
export interface TextLayout {
  width: number;
  height: number;
  /** Wrapped lines, in draw order (always at least one). */
  lines: string[];
}

/**
 * Auto-width layout: as wide as the widest line plus the padding on both sides,
 * floored at MIN_BLOCK_SIZE.width and capped at `maxWidth` — a line longer than
 * the cap wraps inside it instead of growing the block forever.
 */
export function layoutAuto(
  text: string,
  font: FontSpec = DEFAULT_FONT,
  maxWidth = TEXT_MAX_AUTO_WIDTH_WORLD,
  measure: Measurer = estimateWidth,
): TextLayout {
  const cap = Math.max(MIN_BLOCK_SIZE.width, Math.min(maxWidth, TEXT_MAX_AUTO_WIDTH_WORLD));
  let natural = 0;
  for (const line of text.split('\n')) natural = Math.max(natural, measureWidth(line, font, measure));
  const width = Math.min(cap, Math.max(MIN_BLOCK_SIZE.width, Math.ceil(natural) + TEXT_PADDING.x * 2));
  const lines = wrapText(text, width - TEXT_PADDING.x * 2, font, measure);
  return { width, height: boxHeight(lines.length, font), lines };
}

/**
 * Fixed-width layout: the width is given (a resize dragged an edge), the height
 * is measured from the text that now fits in it.
 */
export function layoutFixed(
  text: string,
  width: number,
  font: FontSpec = DEFAULT_FONT,
  measure: Measurer = estimateWidth,
): TextLayout {
  const w = Math.max(MIN_BLOCK_SIZE.width, Math.min(MAX_OBJECT_SIZE_WORLD, width));
  const lines = wrapText(text, w - TEXT_PADDING.x * 2, font, measure);
  return { width: w, height: boxHeight(lines.length, font), lines };
}

// ---------------------------------------------------------------------------
// Layout cache
// ---------------------------------------------------------------------------

/** An entry is keyed per object AND per size token: change the size → new key. */
export interface LayoutEntry extends TextLayout {
  /** Object the layout belongs to. */
  id: string;
  /** Size token it was measured at. */
  token: string;
  /** True when the text changed and the entry has to be recomputed. */
  dirty: boolean;
}

/** Cache key: object id + size token + family + size. */
export function layoutCacheKey(id: string, font: FontSpec): string {
  return `${id}|${font.token}|${font.size}|${font.family}`;
}

/** The layout cache (design: a Map keyed `id|sizeToken`). */
export interface LayoutCache {
  get(key: string): LayoutEntry | undefined;
  set(key: string, entry: LayoutEntry): void;
  /** Drop every entry of one object (delete, undo, or a text change). */
  invalidate(id: string): void;
  clear(): void;
  get size(): number;
}

const CACHE_LIMIT = 2000;

export function createLayoutCache(): LayoutCache {
  const map = new Map<string, LayoutEntry>();
  return {
    get: (key) => map.get(key),
    set: (key, entry) => {
      if (map.size >= CACHE_LIMIT) map.clear();
      map.set(key, entry);
    },
    invalidate: (id) => {
      for (const key of [...map.keys()]) if (key.startsWith(`${id}|`)) map.delete(key);
    },
    clear: () => map.clear(),
    get size() {
      return map.size;
    },
  };
}

/** The cache the board renders from. */
export const layoutCache = createLayoutCache();

/**
 * A canvas-backed measurer, cached per string + font. Where no canvas context
 * exists (a worker, a headless run, a browser that refused to give one) it
 * falls back to the proportional estimate above rather than throwing.
 */
export function createCanvasMeasurer(family: string = TEXT_FONT_FAMILY): Measurer {
  const cache = new Map<string, number>();
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;

  const context = (): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null => {
    if (ctx !== undefined) return ctx;
    ctx = null;
    const doc = typeof document !== 'undefined' ? document : undefined;
    if (doc !== undefined && typeof doc.createElement === 'function') {
      try {
        ctx = doc.createElement('canvas').getContext('2d') ?? null;
      } catch {
        ctx = null;
      }
    } else if (typeof OffscreenCanvas !== 'undefined') {
      try {
        ctx = new OffscreenCanvas(8, 8).getContext('2d') ?? null;
      } catch {
        ctx = null;
      }
    }
    return ctx;
  };

  return (text: string, f: FontSpec): number => {
    if (text.length === 0) return 0;
    const key = `${f.size}px ${f.family || family}|${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const estimate = estimateWidth(text, f);
    const c = context();
    let width = estimate;
    if (c !== null && typeof c.measureText === 'function') {
      try {
        c.font = `${f.size}px ${f.family || family}`;
        const measured = c.measureText(text).width;
        if (Number.isFinite(measured) && measured > 0) width = measured;
      } catch {
        width = estimate;
      }
    }
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(key, width);
    return width;
  };
}
