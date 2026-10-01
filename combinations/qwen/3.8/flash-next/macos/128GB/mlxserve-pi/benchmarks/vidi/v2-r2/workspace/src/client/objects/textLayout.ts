// The text layout (story 9): the one function that decides a text object's box
// from its text, its size preset and its width mode, plus the measurer that
// function is handed.
//
// layoutText is pure. It never touches Yjs, React, the DOM or the network: the
// measurer comes in as an argument, so every rule here is testable with a fake
// measurer and no rendering at all, and the same function answers for a local
// keystroke and for a remote change arriving on another client.
//
// The rules, and nothing else:
//   - the font size is the size preset's, and the only font size there is
//   - the height is always the content's: as many lines as the text makes, each
//     TEXT_LINE_HEIGHT times the font size
//   - in 'auto' width the box is as wide as its longest line, up to
//     TEXT_MAX_AUTO_WIDTH_WORLD, and longer lines wrap into that width
//   - in 'fixed' width the box is the width a side handle dragged, and the text
//     wraps into it
//   - text wraps between words, never inside one: a word longer than the box
//     keeps a line of its own rather than being cut
//   - an empty text is one empty line, so a text object always has a box

import {
  DEFAULT_TEXT_SIZE,
  MAX_OBJECT_SIZE_WORLD,
  TEXT_FONT_FAMILY,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';
import { textLineHeight, type TextWidthMode } from '../../shared/objects/text';

/** The width of `text` drawn at `fontPx`, in world units. */
export type Measurer = (text: string, fontPx: number) => number;

/** The box a text asks for. */
export interface TextLayout {
  width: number;
  height: number;
  /** The lines the text came to, so a test can see where the breaks are. */
  lines: string[];
}

/**
 * With no canvas to measure with, a character is this fraction of the font size
 * wide. It is a guess that never throws: an object measured this way is a little
 * the wrong width, which is a far better failure than a board that cannot show
 * a text at all.
 */
export const TEXT_ESTIMATE_CHAR_RATIO = 0.5;

/** A 2D drawing context, of either kind of canvas. */
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** The size preset's font size, defaulting when a board names no known preset. */
export function textFontPx(size: TextSize): number {
  return TEXT_SIZES[size] ?? TEXT_SIZES[DEFAULT_TEXT_SIZE];
}

/** One line of `size`, in world units: what every line of the layout is tall. */
export function textLayoutLineHeight(size: TextSize): number {
  return textLineHeight(size);
}

/**
 * The box the text asks for. `fixedWidth` is the width a side handle dragged and
 * is used only in 'fixed' width mode; a missing or unusable one falls back to the
 * auto behaviour, because a text object with no usable fixed width has nothing
 * else to be.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: TextWidthMode,
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = textFontPx(size);
  const fixed =
    mode === 'fixed' && Number.isFinite(fixedWidth) && (fixedWidth as number) > 0
      ? clamp(fixedWidth as number, TEXT_MIN_WIDTH_WORLD, MAX_OBJECT_SIZE_WORLD)
      : null;
  const budget = fixed ?? TEXT_MAX_AUTO_WIDTH_WORLD;

  const lines = wrap(text, budget, fontPx, measure);

  // The width the text would take unwrapped decides the mode's answer: a text
  // that fits is as wide as its longest line, and a text that does not is as
  // wide as the width it wrapped into - which is TEXT_MAX_AUTO_WIDTH_WORLD in
  // auto mode, and the dragged width in fixed mode.
  let natural = 0;
  for (const paragraph of text.split('\n')) natural = Math.max(natural, measure(paragraph, fontPx));

  // A measured width is rounded up to a whole world unit so a line is never
  // clipped by a fraction of a pixel; the narrowest box a text may have is the
  // narrowest a handle may drag, so a text object is always something to click.
  const width =
    fixed ??
    (natural > budget
      ? TEXT_MAX_AUTO_WIDTH_WORLD
      : clamp(Math.ceil(natural), TEXT_MIN_WIDTH_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD));

  return { width, height: lines.length * textLayoutLineHeight(size), lines };
}

/**
 * Wrap the text into lines that each measure at most `budget`, between words and
 * never inside one. A paragraph break in the text is a line break; an empty
 * paragraph is an empty line, which is how a blank line keeps its height.
 */
function wrap(text: string, budget: number, fontPx: number, measure: Measurer): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of paragraph.split(' ')) {
      const candidate = current === '' ? word : `${current} ${word}`;
      if (current !== '' && measure(candidate, fontPx) > budget) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

/** The estimate for a string with no canvas: see TEXT_ESTIMATE_CHAR_RATIO. */
export function estimateTextWidth(text: string, fontPx: number): number {
  return Array.from(text).length * fontPx * TEXT_ESTIMATE_CHAR_RATIO;
}

/**
 * A measurer backed by a real canvas, so a line is as wide as the browser draws
 * it. The canvas is made on the first measurement and kept: measuring a line is
 * something a running board does on every keystroke.
 *
 * Where there is no canvas at all - a plain Node process, or a jsdom document
 * that never paints - it estimates instead, and never throws (TC-32).
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  let context: Context2D | null | undefined;

  const acquire = (): Context2D | null => {
    if (context !== undefined) return context;
    context = ((): Context2D | null => {
      // Both canvases are looked up on globalThis rather than named directly:
      // this module is imported by tests that render nothing, and a document
      // that never paints answers `null` for a 2D context.
      const globals = globalThis as typeof globalThis & {
        OffscreenCanvas?: typeof OffscreenCanvas;
      };
      try {
        const OffscreenCanvasCtor = globals.OffscreenCanvas;
        if (OffscreenCanvasCtor !== undefined) {
          const ctx = new OffscreenCanvasCtor(1, 1).getContext('2d');
          if (ctx !== null) return ctx as Context2D;
        }
        const el = document.createElement('canvas');
        const ctx = el.getContext('2d');
        if (ctx !== null) return ctx;
      } catch {
        // no canvas in this environment: the estimate is the answer
      }
      return null;
    })();
    return context;
  };

  return (text: string, fontPx: number): number => {
    if (text === '' || !Number.isFinite(fontPx) || fontPx <= 0) return 0;
    const ctx = acquire();
    if (ctx !== null) {
      try {
        ctx.font = `${fontPx}px ${fontFamily}`;
        const width = ctx.measureText(text).width;
        if (Number.isFinite(width) && width >= 0) return width;
      } catch {
        // a font the engine cannot measure falls back to the estimate
      }
    }
    return estimateTextWidth(text, fontPx);
  };
}
