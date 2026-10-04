import {
  DEFAULT_TEXT_SIZE,
  TEXT_ESTIMATED_GLYPH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
  type TextWidthMode,
} from '../../shared/config';

/**
 * The measurement: how wide a run of text is, in world units, at a font size in pixels.
 *
 * It is a function and not a canvas, because the thing that needs doing - "would this line fit in
 * 600 units?" - must be answerable in a test, in a browser, and on a machine that will not give
 * anybody a canvas. `createCanvasMeasurer` answers with the real glyph widths when it can get a
 * canvas and with an estimate when it cannot; `layoutText` answers with the same box either way for
 * the same measurer, which is what keeps two clients' boxes from disagreeing in the document.
 */
export type Measurer = (text: string, fontPx: number) => number;

/**
 * The estimate: the same number of units per character whatever the character.
 *
 * Deliberately crude. It is used when there is no canvas to ask, and only to decide where lines
 * break and how wide a box is - a little roomier or a little tighter is a box that is a few pixels
 * off, whereas a measurement that is missing is a text object with no box at all. Prose in a
 * western font sits close to half an em per average character, which is what the ratio encodes.
 */
export function estimatedWidth(text: string, fontPx: number): number {
  return text.length * fontPx * TEXT_ESTIMATED_GLYPH_RATIO;
}

/** The one canvas this tab measures text with, or `null` once it is known there is none. */
let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;

/**
 * A context to measure with, or `null` when this machine will not give one.
 *
 * Made once and kept: a canvas used only for `measureText` holds no pixels, so there is no reason
 * for a board with two hundred text objects on it to own two hundred of them. The measurers that
 * come after the first one share it, and each sets the font it wants before it asks.
 */
function acquireContext(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  if (context !== undefined) {
    return context;
  }
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      context = new OffscreenCanvas(8, 8).getContext('2d');
      return context;
    }
    if (typeof document !== 'undefined') {
      context = document.createElement('canvas').getContext('2d');
      return context;
    }
  } catch {
    // jsdom hands back a canvas that throws when asked for a context; a missing measurement is
    // not worth a board that will not open.
  }
  context = null;
  return context;
}

/**
 * A measurer backed by a 2D canvas, falling back to {@link estimatedWidth} when there is none.
 *
 * One canvas for the lifetime of the measurer, because `measureText` is called for every line of
 * every text object on every keystroke and making a canvas each time is the slow way to be lazy.
 * The font is the one text objects are drawn in - see {@link TEXT_FONT_FAMILY} - so the measurement
 * and the pixels agree; when they drift, the box drifts with them and the text stays inside it.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  const context = acquireContext();
  if (context === null) {
    return estimatedWidth;
  }
  let currentFont = '';
  return (text: string, fontPx: number): number => {
    const font = `${fontPx}px ${fontFamily}`;
    if (font !== currentFont) {
      currentFont = font;
      context.font = font;
    }
    return context.measureText(text).width;
  };
}

/** What a piece of text needs: a box, and the lines the box is filled with. */
export interface TextLayout {
  /** World units. `0` when there is nothing to measure - which is not a width the model stores. */
  readonly width: number;
  /** World units: one line height per line, never a box shorter than a single line. */
  readonly height: number;
  /**
   * The lines the text is laid out into: the writer's own breaks kept, each over-long line broken
   * at a word boundary, each over-long word broken where it stops fitting. Only the count is
   * guaranteed to agree with the browser's; it is what the height is worked out from.
   */
  readonly lines: readonly string[];
}

/**
 * The box a text object needs, in world units.
 *
 * The rule the story is told by: *a text object is as wide as its longest line, up to 600 units,
 * and as tall as it needs to be.* Height is therefore always a result and never a thing anybody
 * sets, which is why a text object can be dragged wider but not squashed shorter.
 *
 * - `mode: 'auto'`: as wide as the widest line the writer typed, capped at
 *   {@link TEXT_MAX_AUTO_WIDTH_WORLD}; a line past that is broken at a word boundary and gets a row.
 * - `mode: 'fixed'`: exactly `fixedWidth` - the width a side handle was dragged to, never less than
 *   {@link TEXT_MIN_WIDTH_WORLD} - and every line is wrapped to it.
 *
 * `fixedWidth` is ignored in auto mode, and a fixed mode with no usable width is the minimum box
 * rather than a silent trip back to auto: the person left the object fixed by dragging it, and a
 * missing number in the document is not a decision to undo theirs.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: TextWidthMode,
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = TEXT_SIZES[size] ?? TEXT_SIZES[DEFAULT_TEXT_SIZE];
  const limit =
    mode === 'fixed' ? Math.max(TEXT_MIN_WIDTH_WORLD, usableWidth(fixedWidth)) : TEXT_MAX_AUTO_WIDTH_WORLD;

  const lines: string[] = [];
  let longest = 0;
  for (const source of text.split('\n')) {
    // The writer's own break is a decision: the width is measured per source line, so a heading
    // typed as three lines is as wide as its widest of the three and no wider.
    longest = Math.max(longest, measure(source, fontPx));
    for (const line of wrapLine(source, limit, fontPx, measure)) {
      lines.push(line);
    }
  }

  const width =
    mode === 'fixed'
      ? Math.ceil(limit)
      : Math.min(Math.ceil(longest), TEXT_MAX_AUTO_WIDTH_WORLD);
  const height = Math.max(1, lines.length) * fontPx * TEXT_LINE_HEIGHT;

  return { width, height: Math.round(height), lines };
}

/** The width to lay out at: a finite one, or nothing usable at all. */
function usableWidth(width: number | null): number {
  return typeof width === 'number' && Number.isFinite(width) ? width : TEXT_MIN_WIDTH_WORLD;
}

/**
 * Break one source line to fit `limit`.
 *
 * A line that already fits is returned whole, which is the common case and the only case in which
 * the line count is known to match the browser exactly. Past that the breaks are the ones a browser
 * makes too - at spaces - and a single word that will never fit is cut into lengths, because a word
 * of four thousand characters left whole would be a box one line tall with text running off the
 * board.
 */
function wrapLine(
  line: string,
  limit: number,
  fontPx: number,
  measure: Measurer,
): string[] {
  if (line === '' || measure(line, fontPx) <= limit) {
    return [line];
  }

  const lines: string[] = [];
  let current = '';
  for (const word of line.split(' ')) {
    if (word === '') {
      // Two spaces in a row. The browser keeps both; the box only needs to know how many rows
      // there are, and the row it might have counted twice is a row it already has.
      continue;
    }
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current !== '' && measure(candidate, fontPx) > limit) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
    // A word on its own that is too long is cut, from the front, by however many characters the
    // width holds. The proportion is an estimate; it is within a character or two of the truth
    // with real metrics and exact with a test one.
    for (;;) {
      const width = current === '' ? 0 : measure(current, fontPx);
      if (width <= limit) {
        break;
      }
      const fit = Math.max(1, Math.floor((current.length * limit) / width));
      lines.push(current.slice(0, fit));
      current = current.slice(fit);
    }
  }
  if (current !== '') {
    lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}
