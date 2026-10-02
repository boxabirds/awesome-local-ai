// Laying a text object out: how wide its box is and how many lines it needs.
//
// Pure on purpose. The only thing this module knows about the outside world is
// one function — `Measurer`, "how wide is this string at this font size" — which
// is a real canvas in the browser and a fixed number per character in a test or
// in an environment without a canvas. That is what makes the wrapping maths
// unit-testable without a font, and what lets the same function run in jsdom
// (where there is no text measurement at all) without throwing.
//
// The box this computes is *stored* in the document by `setTextBox`, so every
// client sees the same number of lines without having to measure anything.
import {
  TEXT_BOX_PAD_WORLD,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/** Width in world units of `text` drawn at `fontPx`. */
export type Measurer = (text: string, fontPx: number) => number;

export interface TextLayout {
  /** Board units the box is that wide. */
  width: number;
  /** Board units: one line box per wrapped line. */
  height: number;
  /** The text as it wraps, one entry per line, explicit newlines included. */
  lines: string[];
}

/**
 * A glyph is taken to be this wide when there is no canvas to ask: half the font
 * size per character. It is a guess about Latin text, and it is only ever used
 * where real measurement is impossible — the box it produces is a plausible one,
 * not the one a browser would draw.
 */
export const AVERAGE_GLYPH_WIDTH_RATIO = 0.5;

/** The estimate used when no canvas is available. Never throws, needs no font. */
export const estimateWidth: Measurer = (text, fontPx) =>
  Math.max(0, text.length) * fontPx * AVERAGE_GLYPH_WIDTH_RATIO;

/** Round to the hundredth of a board unit: measurement noise never reaches the document. */
const tidy = (value: number): number => Math.round(value * 100) / 100;

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

let context: Context2D | null | undefined;

/** A drawing context to measure with, or null where none can exist. */
function measurementContext(): Context2D | null {
  if (context !== undefined) return context;
  context = create();
  return context;

  function create(): Context2D | null {
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        const offscreen = new OffscreenCanvas(1, 1);
        const ctx = offscreen.getContext('2d') as Context2D | null;
        if (ctx !== null) return ctx;
      }
      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext?.('2d') as Context2D | null | undefined;
        if (ctx !== null && ctx !== undefined && typeof ctx.measureText === 'function') return ctx;
      }
    } catch {
      // jsdom answers "not implemented" for a canvas: no measurement, no error.
    }
    return null;
  }
}

/**
 * A measurer backed by a real canvas, in the font the text is drawn in — which
 * is the only way to wrap words where a browser would wrap them.
 *
 * Where no canvas exists at all (server render, jsdom) it returns the
 * character-count estimate rather than throwing, so callers never have to know
 * which of the two they were given.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  const ctx = measurementContext();
  if (ctx === null) return estimateWidth;
  return (text: string, fontPx: number): number => {
    try {
      ctx.font = `${fontPx}px ${fontFamily}`;
      return ctx.measureText(text).width;
    } catch {
      return estimateWidth(text, fontPx);
    }
  };
}

/**
 * One hard line, broken into the lines that fit inside `wrapAt`.
 *
 * Greedy, word by word, like a browser's `overflow-wrap: break-word`: a word
 * that does not fit goes to the next line, and a word wider than the box takes a
 * line of its own rather than being cut in half. Spaces between words are not
 * measured at the end of a line, which is why a line of words measures one space
 * shorter than the same words joined by hand.
 */
function wrapLine(line: string, wrapAt: number, fontPx: number, measure: Measurer): string[] {
  if (line === '') return [''];
  const words = line.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current === '' || measure(candidate, fontPx) <= wrapAt) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

/**
 * The box a text object's text needs.
 *
 * - **auto**: as wide as its longest line plus TEXT_BOX_PAD_WORLD, until it would
 *   grow past TEXT_MAX_AUTO_WIDTH_WORLD — at which point the box stops growing
 *   and the text wraps inside it. A single line exactly TEXT_MAX_AUTO_WIDTH_WORLD
 *   wide is not wrapped: it is the widest line an auto box may have.
 * - **fixed**: as wide as it was told to be, never narrower than
 *   TEXT_MIN_WIDTH_WORLD, and its height is however many lines that needs.
 *
 * In both modes the height is the number of lines × the font size ×
 * TEXT_LINE_HEIGHT, which is the same line box the CSS gives the text.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = TEXT_SIZES[size];
  const fixed =
    mode === 'fixed' && fixedWidth !== null && Number.isFinite(fixedWidth) && fixedWidth > 0
      ? Math.max(TEXT_MIN_WIDTH_WORLD, fixedWidth)
      : null;
  const wrapAt = fixed ?? TEXT_MAX_AUTO_WIDTH_WORLD;

  const hard = text.split('\n');
  const lines: string[] = [];
  for (const line of hard) lines.push(...wrapLine(line, wrapAt, fontPx, measure));

  let longest = 0;
  for (const line of lines) longest = Math.max(longest, measure(line, fontPx));

  const width =
    fixed !== null
      ? tidy(fixed)
      : // Text that had to be wrapped fills the widest auto box there is; text
        // that fits is measured, padded, and never allowed past the limit.
        lines.length > hard.length
        ? TEXT_MAX_AUTO_WIDTH_WORLD
        : tidy(Math.min(longest + TEXT_BOX_PAD_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD));

  return { width, height: tidy(lines.length * fontPx * TEXT_LINE_HEIGHT), lines };
}

/**
 * The box a text object's stored text needs, in the mode it is stored in. The
 * one place that reads a text object and asks what size it should be drawn at.
 */
export function layoutOfText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  storedWidth: number,
  measure: Measurer,
): TextLayout {
  return layoutText(text, size, mode, mode === 'fixed' ? storedWidth : null, measure);
}
