/**
 * Text layout: how wide and how tall a piece of text is (`text.layout`).
 *
 * One pure function decides the box of a text object, and everything else -
 * `useTextBoxSync`, the text toolbar, a horizontal handle drag - asks it. It is
 * pure (the measurer is passed in) for two reasons: the rules can be tested with
 * a measurer whose arithmetic is known
 * (`tests/unit/text-layout.test.ts`), and the same rules can run in an
 * environment that has no canvas to measure with.
 *
 * The rules, in the order they apply:
 *
 * 1. The text is split on the newlines the user typed; an empty last line is a
 *    line (`text.height`: "lines the user typed are kept").
 * 2. Each line is wrapped greedily, word by word, at the *wrap width*: the fixed
 *    width in `fixed` mode, `TEXT_MAX_AUTO_WIDTH_WORLD` in `auto` mode. A word
 *    that does not fit on a line of its own is broken at the width, which is what
 *    CSS `overflow-wrap: break-word` paints, so the box and the pixels agree.
 * 3. The width is the fixed width in `fixed` mode; in `auto` mode it is the
 *    longest resulting line plus `TEXT_AUTO_WIDTH_PADDING_WORLD`, capped at
 *    `TEXT_MAX_AUTO_WIDTH_WORLD` - and exactly that limit when the text had to
 *    wrap, because "as wide as its longest line, up to 600 board units" means the
 *    box is full width once the words reach the ceiling.
 * 4. The height is `lines x TEXT_SIZES[size] x TEXT_LINE_HEIGHT`. It is always a
 *    whole number of lines, and it is the only height a text object ever has: no
 *    resize writes it (see `src/shared/objects/text.ts`).
 *
 * Nothing here throws. A measurer that throws (no canvas, a font that will not
 * load, a headless environment) is replaced by `estimateWidth`, priced at
 * {@link TEXT_GLYPH_WIDTH_RATIO}: a box the right *shape* rather than an
 * exception, which is what lets a board written by a server carry text objects.
 */

import {
  DEFAULT_TEXT_SIZE,
  isTextSize,
  MAX_OBJECT_SIZE_WORLD,
  TEXT_AUTO_WIDTH_PADDING_WORLD,
  TEXT_GLYPH_WIDTH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_FONT_FAMILY,
  type TextSize,
} from '../../shared/config.js';

/** How wide `text` is at `fontPx` board units, in board units. */
export type Measurer = (text: string, fontPx: number) => number;

/** The box a piece of text needs. */
export interface TextLayout {
  /** World units; the width the object stores. */
  width: number;
  /** World units; `lines x font size x TEXT_LINE_HEIGHT`. */
  height: number;
  /** The lines as they are drawn, including the empty ones the user typed. */
  lines: string[];
}

/** The font the board draws text with; the measurer must use the same one. */
export const TEXT_LAYOUT_FONT_FAMILY = TEXT_FONT_FAMILY;

/** A font size that can be measured: the size name, or the default for anything else. */
const fontPxOf = (size: TextSize | string): number =>
  TEXT_SIZES[isTextSize(size) ? size : DEFAULT_TEXT_SIZE];

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * The width of `text` when nothing can be measured at all: every character costs
 * {@link TEXT_GLYPH_WIDTH_RATIO} of the font size. Honest about being a guess -
 * it is what a proportional font averages, not what any particular word costs.
 */
export const estimateWidth: Measurer = (text, fontPx) => {
  const characters = typeof text === 'string' ? Array.from(text).length : 0;
  const size = Number.isFinite(fontPx) && fontPx > 0 ? fontPx : TEXT_SIZES[DEFAULT_TEXT_SIZE];
  return characters * size * TEXT_GLYPH_WIDTH_RATIO;
};

/** A measurer that cannot fail: whatever the caller passed, wrapped in a fallback. */
const safeMeasurer = (measure: Measurer | undefined): Measurer => {
  const chosen = typeof measure === 'function' ? measure : estimateWidth;
  return (text: string, fontPx: number): number => {
    try {
      const width = chosen(text, fontPx);
      return typeof width === 'number' && Number.isFinite(width) && width >= 0 ? width : estimateWidth(text, fontPx);
    } catch {
      return estimateWidth(text, fontPx);
    }
  };
};

/**
 * Break one unbreakable word into pieces of at most `width`. A word longer than
 * the whole box has to be cut somewhere or it hangs out of the object, and the
 * place a browser cuts it is where the next character would no longer fit - so
 * that is where this cuts it too.
 */
function breakWord(word: string, fontPx: number, width: number, measure: Measurer): string[] {
  const out: string[] = [];
  let rest = word;
  while (rest.length > 0) {
    let take = 1;
    // Growing one character at a time and measuring the prefix: a word this long
    // is rare, and the loop is bounded by the box, not by the document.
    while (take < rest.length && measure(rest.slice(0, take + 1), fontPx) <= width) take += 1;
    out.push(rest.slice(0, take));
    rest = rest.slice(take);
  }
  return out;
}

/**
 * Greedy word wrap of a single line at `width`: take each word while the line
 * still fits, start a new line when it would not. The line width is accumulated
 * from the words rather than re-measured whole on every candidate, which is
 * within a fraction of a board unit of the measurement of the joined string and
 * keeps a 5,000-character paragraph to one measurement per word.
 */
function wrapLine(line: string, fontPx: number, width: number, measure: Measurer): string[] {
  if (line.length === 0) return [''];
  if (measure(line, fontPx) <= width) return [line];

  const space = measure(' ', fontPx);
  const out: string[] = [];
  let current = '';
  let currentWidth = 0;

  for (const word of line.split(' ')) {
    const wordWidth = measure(word, fontPx);
    if (wordWidth > width) {
      // The word cannot have a line to itself: close the current line and break
      // the word across the next ones.
      if (current !== '') out.push(current);
      current = '';
      currentWidth = 0;
      const pieces = breakWord(word, fontPx, width, measure);
      for (const piece of pieces.slice(0, -1)) out.push(piece);
      current = pieces[pieces.length - 1] as string;
      currentWidth = measure(current, fontPx);
      continue;
    }
    const needed = current === '' ? wordWidth : currentWidth + space + wordWidth;
    if (current === '' || needed <= width) {
      current = current === '' ? word : `${current} ${word}`;
      currentWidth = needed;
    } else {
      out.push(current);
      current = word;
      currentWidth = wordWidth;
    }
  }
  out.push(current);
  return out;
}

/**
 * The box of `text`.
 *
 * @param text the characters, as they stand in the `Y.Text`
 * @param size one of the four size names; anything else measures at the default
 * @param mode `auto` (the box follows the words) or `fixed` (the words wrap in a
 *     width somebody dragged), anything else counts as `auto`
 * @param fixedWidth the width to wrap at in `fixed` mode; clamped to at least
 *     {@link TEXT_MIN_WIDTH_WORLD}, so a stored nonsense value still gives a box
 * @param measure how wide a string is; {@link createCanvasMeasurer} in the app,
 *     anything in a test, and a fallback is used if it throws
 */
export function layoutText(
  text: string,
  size: TextSize | string,
  mode: 'auto' | 'fixed' | string,
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = fontPxOf(size);
  const widthOf = safeMeasurer(measure);
  const characters = typeof text === 'string' ? text : '';
  const typed = characters.split('\n');

  const fixed = mode === 'fixed';
  const wrapWidth = fixed
    ? clamp(
        typeof fixedWidth === 'number' && Number.isFinite(fixedWidth)
          ? fixedWidth
          : TEXT_MIN_WIDTH_WORLD,
        TEXT_MIN_WIDTH_WORLD,
        MAX_OBJECT_SIZE_WORLD,
      )
    : TEXT_MAX_AUTO_WIDTH_WORLD;

  const lines: string[] = [];
  let wrapped = false;
  let longest = 0;
  for (const line of typed) {
    const pieces = wrapLine(line, fontPx, wrapWidth, widthOf);
    if (pieces.length > 1) wrapped = true;
    for (const piece of pieces) {
      const width = widthOf(piece, fontPx);
      if (width > longest) longest = width;
      lines.push(piece);
    }
  }

  const width = fixed
    ? wrapWidth
    : wrapped
      ? TEXT_MAX_AUTO_WIDTH_WORLD
      : clamp(longest + TEXT_AUTO_WIDTH_PADDING_WORLD, TEXT_MIN_WIDTH_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD);

  return { width, height: lines.length * fontPx * TEXT_LINE_HEIGHT, lines };
}

/** How many measurement results one canvas measurer remembers. */
const MEASUREMENT_CACHE_LIMIT = 4096;

/**
 * A measurer backed by a canvas 2D context - the same text metrics the browser
 * uses to lay the line out, which is why the height computed from it and the
 * height the DOM paints agree.
 *
 * The font size is in *board units*, because the text is drawn inside the scaled
 * world layer: a box measured at 20 board units is 20 board units wide whatever
 * the zoom, so a zoom change never needs a re-measurement.
 *
 * Results are remembered, because a paragraph is re-wrapped on every keystroke and
 * most of its lines did not change. The cache is dropped when it gets big, so a
 * long typing session cannot grow it without limit.
 *
 * No canvas (a server-side render, a test environment without one) means
 * {@link estimateWidth} instead: a guess, but a box - never an exception.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_LAYOUT_FONT_FAMILY): Measurer {
  const font = typeof fontFamily === 'string' && fontFamily.length > 0 ? fontFamily : TEXT_LAYOUT_FONT_FAMILY;
  let context: CanvasRenderingContext2D | null | undefined;
  const cache = new Map<string, number>();

  const contextFor = (): CanvasRenderingContext2D | null => {
    if (context !== undefined) return context;
    context = null;
    if (typeof document !== 'undefined') {
      try {
        const canvas = document.createElement('canvas');
        context = canvas.getContext('2d');
      } catch {
        context = null;
      }
    }
    if (context !== null) context.font = `1px ${font}`;
    return context;
  };

  return (text, fontPx) => {
    const size = Number.isFinite(fontPx) && fontPx > 0 ? fontPx : TEXT_SIZES[DEFAULT_TEXT_SIZE];
    const key = `${size}|${text}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const ctx = contextFor();
    let width: number;
    if (ctx === null) {
      width = estimateWidth(text, size);
    } else {
      try {
        ctx.font = `${size}px ${font}`;
        width = ctx.measureText(typeof text === 'string' ? text : '').width;
      } catch {
        width = estimateWidth(text, size);
      }
    }
    if (!Number.isFinite(width) || width < 0) width = estimateWidth(text, size);
    if (cache.size >= MEASUREMENT_CACHE_LIMIT) cache.clear();
    cache.set(key, width);
    return width;
  };
}
