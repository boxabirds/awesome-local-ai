import {
  DEFAULT_TEXT_SIZE,
  TEXT_BOX_PADDING_WORLD,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';
import type { TextWidthMode } from '../../shared/objects/text';

/**
 * How a text object's box is measured (story 9).
 *
 * A text's height is always its content, and its width is either its longest line or the
 * width a side handle pinned it to. The measuring itself belongs to whoever can measure:
 * `layoutText` takes a `Measurer` so the rules are unit-testable with a fake, and
 * `createCanvasMeasurer` supplies the real one — a canvas that is only reached for when
 * one exists, because an environment without 2d contexts (a Worker, a test) still has to
 * lay text out reasonably rather than fail.
 */

/** How wide `text` is when drawn at `fontPx`. Board units in, board units out. */
export type Measurer = (text: string, fontPx: number) => number;

/**
 * How wide an average glyph is compared to the font size, used where there is no canvas to
 * measure with (an environment without 2d contexts, or a line too long to bother with).
 * It only ever has to be close: the box is re-measured by whoever has real fonts.
 */
export const TEXT_AVERAGE_GLYPH_WIDTH_RATIO = 0.52;

/**
 * The estimate: characters × font size × the average glyph ratio. Code points are counted,
 * so an emoji counts once rather than as its two UTF-16 units.
 */
export function estimateTextWidth(text: string, fontPx: number): number {
  if (!Number.isFinite(fontPx) || fontPx <= 0) return 0;
  return Array.from(text ?? '').length * fontPx * TEXT_AVERAGE_GLYPH_WIDTH_RATIO;
}

/** One canvas and context per font family, made on the first measurement that needs one. */
const contexts = new Map<string, CanvasRenderingContext2D | null>();
/** The last font the cached context was set to, so measuring a run sets it once. */
const appliedFonts = new Map<string, string>();

/**
 * The 2d context to measure with, or null where there is none. Never throws: an
 * environment without a canvas, or one that refuses a 2d context, gets null and the
 * caller falls back to the estimate.
 */
function measureContext(fontFamily: string): CanvasRenderingContext2D | null {
  const known = contexts.get(fontFamily);
  if (known !== undefined) return known;
  let context: CanvasRenderingContext2D | null = null;
  try {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      const created = canvas.getContext('2d');
      if (created) context = created;
    }
  } catch {
    context = null;
  }
  contexts.set(fontFamily, context);
  return context;
}

/**
 * A measurer that asks a canvas what the board's fonts would really do. Every text object
 * on a screen shares one (`defaultMeasurer`), since a canvas and its cached font cost more
 * than the arithmetic.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  return (text: string, fontPx: number): number => {
    const context = measureContext(fontFamily);
    if (!context) return estimateTextWidth(text, fontPx);
    const font = `${fontPx}px ${fontFamily}`;
    if (appliedFonts.get(fontFamily) !== font) {
      context.font = font;
      appliedFonts.set(fontFamily, font);
    }
    const width = context.measureText(text ?? '').width;
    return Number.isFinite(width) ? width : estimateTextWidth(text, fontPx);
  };
}

let shared: Measurer | undefined;

/** The measurer the board uses: one canvas-backed measurer for the whole screen. */
export function defaultMeasurer(): Measurer {
  shared ??= createCanvasMeasurer();
  return shared;
}

/** What a text object's box should be, and how many lines that took. */
export interface TextLayout {
  /** Stored `width` of the object, in board units. */
  width: number;
  /** Stored `height` of the object, in board units. */
  height: number;
  /** Lines of text, wrapped and newlines included; what `height` is built from. */
  lines: number;
}

/** A measurement that went wrong (a fake measurer, a NaN) must not lose a line of text. */
function widthOf(measure: Measurer, text: string, fontPx: number): number {
  const width = measure(text, fontPx);
  return Number.isFinite(width) && width >= 0 ? width : estimateTextWidth(text, fontPx);
}

/**
 * Greedy word wrap of one line: fill the line while the next word still fits, then start
 * another. A word wider than the line gets a line to itself — text is never cut up, and
 * the loop always moves forward, so one enormous word cannot spin for ever.
 */
function wrapLine(
  line: string,
  capacity: number,
  fontPx: number,
  measure: Measurer,
): string[] {
  const words = line.split(' ');
  const spaceWidth = widthOf(measure, ' ', fontPx);
  const wrapped: string[] = [];
  let current = '';
  let currentWidth = 0;
  for (const one of words) {
    const oneWidth = widthOf(measure, one, fontPx);
    if (current === '') {
      current = one;
      currentWidth = oneWidth;
      continue;
    }
    if (currentWidth + spaceWidth + oneWidth <= capacity) {
      current = `${current} ${one}`;
      currentWidth += spaceWidth + oneWidth;
      continue;
    }
    wrapped.push(current);
    current = one;
    currentWidth = oneWidth;
  }
  wrapped.push(current);
  return wrapped;
}

/**
 * The box `text` needs, in board units.
 *
 * Automatic width: as wide as its longest line plus `TEXT_BOX_PADDING_WORLD`, capped at
 * `TEXT_MAX_AUTO_WIDTH_WORLD` and wrapped at that cap when it goes past it. Fixed width:
 * exactly `fixedWidth` (never below `TEXT_MIN_WIDTH_WORLD`), wrapped there, whatever the
 * mode — that is the difference a side handle makes. `height` is line count × font size ×
 * `TEXT_LINE_HEIGHT` either way, so the height is always the content.
 *
 * A `fixedWidth` that is not a number leaves the object measuring as automatic: a box is
 * never allowed to become meaningless.
 */
export function layoutText(
  text: string,
  size: TextSize = DEFAULT_TEXT_SIZE,
  mode: TextWidthMode = 'auto',
  fixedWidth: number | null = null,
  measure: Measurer = estimateTextWidth,
): TextLayout {
  const fontPx = TEXT_SIZES[size] ?? TEXT_SIZES[DEFAULT_TEXT_SIZE];
  const fixed =
    mode === 'fixed' && Number.isFinite(fixedWidth ?? Number.NaN)
      ? Math.max(fixedWidth as number, TEXT_MIN_WIDTH_WORLD)
      : null;
  const capacity = fixed ?? TEXT_MAX_AUTO_WIDTH_WORLD;

  const lines: string[] = [];
  let widest = 0;
  for (const one of (text ?? '').split('\n')) {
    const measured = widthOf(measure, one, fontPx);
    if (measured > widest) widest = measured;
    if (measured <= capacity) {
      lines.push(one);
      continue;
    }
    for (const wrapped of wrapLine(one, capacity, fontPx, measure)) lines.push(wrapped);
  }

  const width = fixed ?? Math.min(widest + TEXT_BOX_PADDING_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD);
  return {
    width: Math.max(width, TEXT_MIN_WIDTH_WORLD),
    height: lines.length * fontPx * TEXT_LINE_HEIGHT,
    lines: lines.length,
  };
}
