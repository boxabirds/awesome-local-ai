/**
 * How big a text object is: pure maths over its characters, its size preset and a way to measure them.
 *
 * Nothing here touches a `Y.Doc` or React. The board asks one question — how wide and how tall is this
 * text, drawn at this size, in this width mode — and gets an answer it can store. The box is stored
 * rather than recomputed by everybody because selection bounds, the marquee and an export all need the
 * size of an object that may not be on this screen at all, and because a client that measured its own
 * change is the only one that has to say what the box became (see `useTextBoxSync`).
 *
 * The measurement is a function passed in, which is what keeps this file testable: a unit test hands it
 * a deterministic ruler (a fixed number of units per character) and gets arithmetic it can read off,
 * while the browser hands it a canvas and gets the real shape of the font.
 */

import {
  DEFAULT_TEXT_SIZE,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';
import { TEXT_GLYPH_WIDTH_RATIO } from '../../shared/objects/text';

/** Width in world units of `text` drawn at `fontPx`. */
export type Measurer = (text: string, fontPx: number) => number;

/** The box a text object's content asks for, and the lines it is drawn as. */
export interface TextLayout {
  /** Width in world units — the box's own, not the longest line's when a word will not fit. */
  width: number;
  /** Height in world units: one line per wrapped line, always. */
  height: number;
  /** The text as it is broken onto lines, without the newlines that separated the hard ones. */
  lines: string[];
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The font size of a size preset, or of the default when a document invented a size. */
const fontPxOf = (size: TextSize): number => {
  const px: unknown = TEXT_SIZES[size];
  return finite(px) && px > 0 ? px : TEXT_SIZES[DEFAULT_TEXT_SIZE];
};

/**
 * How tall one of these lines is: the font size the product named, times the line height the product
 * named. Nothing in between is measured, because the text is not being measured for a browser here —
 * it is being laid out in the same units the board is drawn in.
 */
export const textLineHeight = (size: TextSize): number => fontPxOf(size) * TEXT_LINE_HEIGHT;

/** A rough width for a string, from the average glyph: the answer when nothing can be measured. */
export function estimateTextWidth(text: string, fontPx: number): number {
  if (typeof text !== 'string' || text.length === 0) return 0;
  return text.length * fontPx * TEXT_GLYPH_WIDTH_RATIO;
}

interface Canvas2DLike {
  font: string;
  measureText(text: string): { width: number };
}

/** The 2D context of a canvas we can measure with, or nothing when this environment has none. */
function contextFor(fontFamily: string): Canvas2DLike | null {
  try {
    const Canvas = typeof OffscreenCanvas !== 'undefined' ? OffscreenCanvas : undefined;
    if (Canvas !== undefined) {
      const ctx = new Canvas(1, 1).getContext('2d') as Canvas2DLike | null;
      if (ctx !== null) {
        ctx.font = `12px ${fontFamily}`; // fail fast when the context cannot take a font at all
        return ctx;
      }
    }
    const doc = typeof document !== 'undefined' ? document : undefined;
    const el = doc?.createElement('canvas');
    const getContext = (el as unknown as HTMLCanvasElement | undefined)?.getContext;
    if (typeof getContext === 'function') {
      const ctx = getContext.call(el, '2d') as Canvas2DLike | null;
      if (ctx !== null) {
        ctx.font = `12px ${fontFamily}`;
        return ctx;
      }
    }
  } catch {
    // No canvas of any kind: the estimate below is the answer, and it is not an error.
  }
  return null;
}

/**
 * A measurer that asks the browser how wide the words actually are, in the font the board draws text in.
 *
 * It is created once per board and reused, because building the drawing surface is the expensive part
 * and asking it a question is not. When there is no drawing surface at all — a test environment without
 * canvas, a browser that refused one — the returned function estimates from the character count and
 * never throws: a text object whose box cannot be measured precisely is still a text object with a box.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  const family = typeof fontFamily === 'string' && fontFamily.length > 0 ? fontFamily : TEXT_FONT_FAMILY;
  const ctx = contextFor(family);
  if (ctx === null) return estimateTextWidth;

  let font = '';
  return (text: string, fontPx: number) => {
    if (typeof text !== 'string' || text.length === 0) return 0;
    if (!finite(fontPx) || fontPx <= 0) return estimateTextWidth(text, fontPx);
    try {
      const next = `${fontPx}px ${family}`;
      if (next !== font) {
        ctx.font = next;
        font = next;
      }
      const width = ctx.measureText(text).width;
      return finite(width) && width >= 0 ? width : estimateTextWidth(text, fontPx);
    } catch {
      // A context that stopped working (a canvas the browser took back): estimate, do not throw.
      return estimateTextWidth(text, fontPx);
    }
  };
}

/** The one measurer of this page, built on first use. */
let sharedMeasurer: Measurer | null = null;

/**
 * The measurer of this page, made on the first request for one and reused by everything after it.
 *
 * Every text object, every measurement after a size change and the resize gesture all want the same
 * ruler, and building one means a canvas and a font. It is a function rather than a constant because a
 * page that never shows a text object should not pay for a canvas.
 */
export function defaultMeasurer(): Measurer {
  if (sharedMeasurer === null) sharedMeasurer = createCanvasMeasurer();
  return sharedMeasurer;
}

/**
 * A hard line broken into the lines it is drawn as, greedily: as many words as fit, then the next line.
 *
 * A word longer than the line is not cut — there is no rule here about where a word may be split, and
 * cutting one would disagree with the browser, which breaks it by glyph when it draws. It gets a line
 * of its own and the box keeps the width it was given, which is what the line looks like on screen.
 */
function wrapLine(line: string, maxWidth: number, fontPx: number, measure: Measurer): string[] {
  if (line.length === 0) return [''];
  const words = line.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    // A line of one word is never wrapped again, so a long word cannot loop forever.
    if (current.length > 0 && measure(`${current} ${word}`, fontPx) > maxWidth) {
      lines.push(current);
      current = word;
      continue;
    }
    current = current.length === 0 ? word : `${current} ${word}`;
  }
  lines.push(current);
  return lines;
}

/** The widest a line may run before it has to wrap: the person's width, or the product's limit. */
const wrapWidthOf = (mode: 'auto' | 'fixed', fixedWidth: number | null): number =>
  mode === 'fixed' && finite(fixedWidth) && fixedWidth > 0
    ? Math.max(TEXT_MIN_WIDTH_WORLD, fixedWidth)
    : TEXT_MAX_AUTO_WIDTH_WORLD;

/**
 * The box a text object's content asks for.
 *
 * - **auto** — as wide as its longest line, up to `TEXT_MAX_AUTO_WIDTH_WORLD`; a line longer than that
 *   limit is wrapped at the limit, so a paragraph becomes a column instead of a stripe across the
 *   board. The width is the measured content, with nothing added for padding: the text is drawn from
 *   the edge of its box, which is what "a box just wider than the words" means.
 * - **fixed** — the width the person dragged a side handle to, never below `TEXT_MIN_WIDTH_WORLD`, and
 *   the content rewrapped into it.
 *
 * Either way the height is the number of lines it is drawn as — hard newlines and wraps both counted —
 * times `TEXT_SIZES[size] × TEXT_LINE_HEIGHT`. Height belongs to the content and to nothing else:
 * there is no handle that sets it (TC-24).
 *
 * An empty text object lays out as one line of nothing, which is zero wide; the caller that stores the
 * box refuses a width of zero and leaves the estimate the object was created with.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = fontPxOf(size);
  const maxWidth = wrapWidthOf(mode, fixedWidth);
  const measureLine = typeof measure === 'function' ? measure : estimateTextWidth;
  const source = typeof text === 'string' ? text : '';

  const lines: string[] = [];
  let longest = 0;
  for (const hardLine of source.split('\n')) {
    // The width the content asks for is the width of the longest line the person wrote, before any
    // wrapping: a paragraph that does not fit is content that wants more room than the limit gives it,
    // and the box takes the whole of the limit rather than hugging the last wrapped line.
    longest = Math.max(longest, measureLine(hardLine, fontPx));
    for (const line of wrapLine(hardLine, maxWidth, fontPx, measureLine)) lines.push(line);
  }
  if (lines.length === 0) lines.push('');

  const auto = mode !== 'fixed' || !finite(fixedWidth) || (fixedWidth as number) <= 0;
  const width = auto ? Math.min(longest, TEXT_MAX_AUTO_WIDTH_WORLD) : maxWidth;

  return {
    width,
    height: lines.length * fontPx * TEXT_LINE_HEIGHT,
    lines,
  };
}
