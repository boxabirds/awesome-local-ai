import {
  TEXT_BOX_PADDING_WORLD,
  TEXT_ESTIMATED_GLYPH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../shared/config';
import type { TextSize } from '../../shared/config';

/**
 * Story 9: how wide and how tall a piece of text is (`text.layout`).
 *
 * All of it is pure and the one unknowable thing — how wide a real font draws a
 * line — is an argument. That is what lets the layout be tested down to the
 * board unit with a fake measurer, run in a browser against a canvas, and go on
 * working, approximately, where there is no canvas to ask.
 *
 * A text object's box is what this file computes; the document stores it, so
 * selection, marquee and export never measure anything
 * (`useTextBoxSync` writes it, and only for the client that changed the text).
 */

/** How wide `text` is, drawn at `fontPx`, in board units. */
export type Measurer = (text: string, fontPx: number) => number;

/** The box a piece of text needs, in board units. */
export interface TextLayout {
  readonly width: number;
  readonly height: number;
  /** The lines the text was broken into, which is what `height` counts. */
  readonly lines: readonly string[];
}

/**
 * Measure and wrap `text`.
 *
 * Automatic width (`text.auto_width`): as wide as the longest line, up to
 * `TEXT_MAX_AUTO_WIDTH_WORLD`, and no narrower than the smallest box there is —
 * an empty heading is still something you can click. A line longer than the
 * limit is wrapped word by word.
 *
 * Fixed width (`text.fixed_width`): exactly `fixedWidth`, whatever the content
 * thinks, and the words wrap to it.
 *
 * Either way the height is the line count (`text.height`): height always follows
 * the content, and no handle changes it directly.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = TEXT_SIZES[size];
  const asked =
    mode === 'fixed' && typeof fixedWidth === 'number' && Number.isFinite(fixedWidth)
      ? fixedWidth
      : TEXT_MIN_WIDTH_WORLD;
  const fixed = Math.max(TEXT_MIN_WIDTH_WORLD, asked);
  // A line is wrapped when it is longer than the room the board gives it: the
  // automatic limit for a text that follows its content (`text.auto_width`'s 600
  // board units — exactly 600 is still one line), and inside the padding for a
  // text whose width somebody set, since that width is the box, edge to edge.
  const wrapWidth = mode === 'fixed' ? Math.max(1, fixed - TEXT_BOX_PADDING_WORLD * 2) : TEXT_MAX_AUTO_WIDTH_WORLD;

  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    lines.push(...wrapWords(paragraph, wrapWidth, fontPx, measure));
  }

  let widest = 0;
  for (const line of lines) widest = Math.max(widest, measure(line, fontPx));

  // The padding is outside the words and inside the box, except where the box
  // has already reached the limit: a line at the limit is a line at the limit.
  const width =
    mode === 'fixed'
      ? Math.round(fixed)
      : Math.round(
          Math.min(
            TEXT_MAX_AUTO_WIDTH_WORLD,
            Math.max(TEXT_MIN_WIDTH_WORLD, widest + TEXT_BOX_PADDING_WORLD * 2),
          ),
        );

  return { width, height: lineHeight(lines.length, size), lines };
}

/** How tall `lines` lines of `size` are — the same multiple the CSS uses. */
export function lineHeight(lines: number, size: TextSize): number {
  return Math.round(lines * TEXT_SIZES[size] * TEXT_LINE_HEIGHT);
}

/**
 * Greedy word wrap: as many words as fit, then the next line. A word wider than
 * the line gets a line to itself rather than being split or dropped — a heading
 * of one enormous word is still a heading, and this is the difference between
 * wrapping and looping.
 */
function wrapWords(line: string, width: number, fontPx: number, measure: Measurer): string[] {
  if (line === '') return [''];
  const out: string[] = [];
  let current = '';
  for (const word of line.split(' ')) {
    if (current === '') {
      current = word;
      continue;
    }
    const together = `${current} ${word}`;
    if (measure(together, fontPx) <= width) {
      current = together;
      continue;
    }
    out.push(current);
    current = word;
  }
  out.push(current);
  return out;
}

/** A character's width when nothing can be measured — an estimate, never a guess of 0. */
export function estimateWidth(text: string, fontPx: number): number {
  return text.length * fontPx * TEXT_ESTIMATED_GLYPH_RATIO;
}

/**
 * A measurer backed by a canvas, which is the only thing that knows what the
 * font in `fontFamily` actually draws (`TEXT_FONT_FAMILY` is the stack the board
 * renders text with, so what is measured here is what is drawn there).
 *
 * Where there is no canvas — a worker, a machine without one, a test that never
 * had a font — it estimates instead, from {@link TEXT_ESTIMATED_GLYPH_RATIO}. It
 * still never throws: a text object whose box was estimated is a text object
 * with a slightly wrong box, and that is all it is.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  const canvas = canvasContext();
  if (!canvas) return estimateWidth;
  return (text, fontPx) => {
    try {
      canvas.font = `${fontPx}px ${fontFamily}`;
      const width = canvas.measureText(text).width;
      return Number.isFinite(width) ? width : estimateWidth(text, fontPx);
    } catch {
      // A font that will not be set, or a context that lost its surface: either
      // way the answer is the estimate, not an exception.
      return estimateWidth(text, fontPx);
    }
  };
}

/** The shared measurement surface, or `null` when this environment has none. */
function canvasContext(): CanvasRenderingContext2D | null {
  if (context !== undefined) return context;
  context = makeContext();
  return context;
}

let context: CanvasRenderingContext2D | null | undefined;

function makeContext(): CanvasRenderingContext2D | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const offscreen = new OffscreenCanvas(1, 1);
      const ctx = offscreen.getContext('2d');
      if (ctx) return ctx as unknown as CanvasRenderingContext2D;
    }
    if (typeof document !== 'undefined') {
      const ctx = document.createElement('canvas').getContext('2d');
      if (ctx) return ctx;
    }
  } catch {
    return null; // no canvas in this environment, which is not an error
  }
  return null;
}
