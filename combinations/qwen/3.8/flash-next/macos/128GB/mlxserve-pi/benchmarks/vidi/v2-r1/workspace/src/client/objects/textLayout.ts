// What a text object's box is, given its text, its size and its width mode
// (`text.wrap`). Pure layout maths: no DOM, no React, no Yjs.
//
// The one thing here that is not arithmetic is the measure function. A string is
// only as wide as the font says it is, so the caller hands in a measurer — a real
// canvas context in the browser, a fixed guess where there is no canvas (a Worker,
// a unit test), and *the same one everywhere* so five clients do not draw five
// different boxes for one change (Key decision 1 in design.md).
//
// Spec: spec/stories/009-write-free-text-anywhere-on-the-board/design.md
import {
  DEFAULT_TEXT_SIZE,
  MAX_OBJECT_SIZE_WORLD,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/** Measure `text` at `fontPx` board units and answer its width in board units. */
export type Measurer = (text: string, fontPx: number) => number;

/**
 * Air around the text, per side, in board units. The box is a little wider than
 * the longest line so the selection outline does not sit on the glyphs; a box at
 * the maximum width is the limit the text actually wraps at.
 */
export const TEXT_LAYOUT_PADDING_WORLD = 8;

/**
 * The fixed guess used when there is no canvas to ask: an average glyph is this
 * many font sizes wide. Deliberately not zero — a layout that measured nothing
 * would stack every character on one line.
 */
export const TEXT_ESTIMATED_GLYPH_RATIO = 0.5;

export interface TextLayout {
  /** The box's width in board units. */
  width: number;
  /** The box's height in board units: the wrapped lines, counted. */
  height: number;
  /** The lines the text wrapped into, for the tests and the overflow counter. */
  lines: string[];
}

const clampWidth = (width: number): number =>
  Math.min(Math.max(width, TEXT_MIN_WIDTH_WORLD), MAX_OBJECT_SIZE_WORLD);

/** The font size of a size name, falling back to the default size. */
export const textSizePx = (size: TextSize | string): number =>
  (typeof size === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, size)
    ? TEXT_SIZES[size as TextSize]
    : TEXT_SIZES[DEFAULT_TEXT_SIZE]);

const estimatedWidth = (text: string, fontPx: number): number =>
  text.length * fontPx * TEXT_ESTIMATED_GLYPH_RATIO;

/**
 * A measurer that asks a real canvas, and asks it once per size.
 *
 * When there is no canvas at all — no `OffscreenCanvas`, no `document`, a context
 * that could not be made, a `measureText` that throws — it returns the fixed guess
 * instead of failing, because the layout then still produces a box the same way on
 * every client that also has no canvas.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  type Context = { font: string; measureText: (text: string) => { width: number } };
  let context: Context | null | undefined;
  let fontPxUsed = -1;

  const acquire = (): Context | null => {
    if (context !== undefined) return context;
    context = null;
    try {
      const canvas: unknown =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(1, 1)
          : typeof document !== 'undefined'
            ? document.createElement('canvas')
            : null;
      if (canvas && typeof (canvas as HTMLCanvasElement).getContext === 'function') {
        const got = (canvas as HTMLCanvasElement).getContext('2d') as Context | null;
        context = got && typeof got.measureText === 'function' ? got : null;
      }
    } catch {
      context = null;
    }
    return context;
  };

  return (text, fontPx) => {
    const ctx = acquire();
    if (!ctx || !Number.isFinite(fontPx) || fontPx <= 0) {
      return estimatedWidth(text, fontPx);
    }
    if (fontPxUsed !== fontPx) {
      try {
        ctx.font = `${fontPx}px ${fontFamily}`;
      } catch {
        return estimatedWidth(text, fontPx);
      }
      // A context that will not take the font would measure at its own default
      // size, which is a different box on every platform. Don't use it.
      if (typeof ctx.font !== 'string' || !ctx.font.includes(`${fontPx}px`)) {
        return estimatedWidth(text, fontPx);
      }
      fontPxUsed = fontPx;
    }
    try {
      const width = ctx.measureText(text).width;
      return Number.isFinite(width) ? width : estimatedWidth(text, fontPx);
    } catch {
      return estimatedWidth(text, fontPx);
    }
  };
}

/** How much of `word` fits in `limit`, at least one character. */
function prefixThatFits(
  word: string,
  limit: number,
  fontPx: number,
  measure: Measurer,
): number {
  let low = 1;
  let high = word.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measure(word.slice(0, middle), fontPx) <= limit) low = middle;
    else high = middle - 1;
  }
  return Math.max(1, Math.min(low, word.length));
}

/**
 * One source line, wrapped to `limit`. Word by word, and only split inside a word
 * when that word does not fit on a line of its own — which is what the browser
 * does with `overflow-wrap: break-word`, so the height computed here is the height
 * the text needs where it is drawn.
 */
function wrapLine(
  line: string,
  limit: number,
  fontPx: number,
  measure: Measurer,
): string[] {
  if (limit <= 0) return [line];
  if (measure(line, fontPx) <= limit) return [line];

  const out: string[] = [];
  let current = '';
  for (const word of line.split(' ')) {
    let piece = word;
    // This word alone is too long for a line: cut it where the line ends.
    while (piece !== '' && measure(piece, fontPx) > limit) {
      if (current !== '') {
        out.push(current);
        current = '';
      }
      const take = prefixThatFits(piece, limit, fontPx, measure);
      out.push(piece.slice(0, take));
      piece = piece.slice(take);
    }
    const joined = current === '' ? piece : `${current} ${piece}`;
    if (piece !== '' && measure(joined, fontPx) <= limit) {
      current = joined;
    } else if (piece !== '') {
      if (current !== '') out.push(current);
      current = piece;
    }
  }
  if (current !== '') out.push(current);
  // A line made of nothing but spaces still occupies a line box.
  return out.length > 0 ? out : [''];
}

export interface TextLayoutInput {
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
  /** The width a `fixed` box wraps to (ignored in `auto` mode). */
  width?: number;
  measure: Measurer;
}

/**
 * The box a piece of text takes.
 *
 *   - **auto** — as wide as its longest line, up to TEXT_MAX_AUTO_WIDTH_WORLD, and
 *     as tall as the lines that don't fit in that width. A line longer than the
 *     maximum wraps instead of stretching the box across the board.
 *   - **fixed** — the width it was given (never narrower than TEXT_MIN_WIDTH_WORLD)
 *     and nothing else; only the height follows the wrapped lines.
 *
 * Height is always `lines × size × TEXT_LINE_HEIGHT` — one line box for the
 * empty text too, so a box always has a height.
 */
export function layoutText(input: TextLayoutInput): TextLayout {
  const measure =
    typeof input.measure === 'function' ? input.measure : estimatedWidth;
  const fontPx = textSizePx(input.size);
  const text = typeof input.text === 'string' ? input.text : '';
  const source = text.split('\n');

  let longest = 0;
  for (const line of source) {
    const width = measure(line, fontPx);
    if (Number.isFinite(width) && width > longest) longest = width;
  }

  let boxWidth: number;
  let limit: number;
  if (input.widthMode === 'fixed') {
    boxWidth = clampWidth(Number.isFinite(input.width ?? NaN) ? (input.width as number) : TEXT_MIN_WIDTH_WORLD);
    limit = boxWidth;
  } else {
    // The wrap limit is the widest box an auto box may ever be; the box itself is
    // the longest line plus air, and never more than that.
    limit = Math.min(longest, TEXT_MAX_AUTO_WIDTH_WORLD);
    boxWidth = clampWidth(Math.min(longest + TEXT_LAYOUT_PADDING_WORLD * 2, TEXT_MAX_AUTO_WIDTH_WORLD));
  }

  const lines: string[] = [];
  for (const line of source) lines.push(...wrapLine(line, limit, fontPx, measure));

  return {
    width: boxWidth,
    height: lines.length * fontPx * TEXT_LINE_HEIGHT,
    lines,
  };
}

/** How many lines `text` needs at `size` inside `width`. */
export function lineCount(
  text: string,
  size: TextSize,
  widthMode: 'auto' | 'fixed',
  width: number,
  measure: Measurer,
): number {
  return layoutText({ text, size, widthMode, width, measure }).lines.length;
}

/**
 * The one measurer the board uses. Every client-side layout goes through it, so
 * the same text on the same screen always comes out the same width — and because
 * the canvas is only reached for on the first measurement, a screen with no canvas
 * (a test, a Worker) uses the fixed guess for everything instead of mixing the two.
 */
export const boardMeasurer: Measurer = createCanvasMeasurer();
