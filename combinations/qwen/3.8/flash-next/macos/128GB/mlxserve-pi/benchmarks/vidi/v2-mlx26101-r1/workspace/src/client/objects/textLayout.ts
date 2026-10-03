// Pure text layout for free text objects (story 9). See the text.layout contract.
//
// The board stores a text object's box (width / height) rather than re-measuring on
// every client, so exactly one thing has to answer "how big is this text?" — this
// module. It is pure: given the text, its size preset, its width mode and a
// `Measurer`, it returns the box and the wrapped lines. No Yjs, no DOM (the measurer
// is injected), so the maths is unit-testable with a fake measurer and deterministic.
//
// Rules (text.auto_width / text.fixed_width / text.height):
//  - auto:   width = the longest line, capped at TEXT_MAX_AUTO_WIDTH_WORLD; a line
//            wider than that wraps, and once any line wraps the box fills to the cap.
//  - fixed:  width = the fixed width (never below TEXT_MIN_WIDTH_WORLD); text rewraps.
//  - height: always the number of rendered lines × the font size × TEXT_LINE_HEIGHT.
//            There is no way to set height directly — it always follows the content.

import {
  TEXT_AUTO_WIDTH_PADDING_WORLD,
  TEXT_AVG_GLYPH_WIDTH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/** Measure `text`'s width, in world units, when drawn at `fontPx`. */
export type Measurer = (text: string, fontPx: number) => number;

/** The box a text object occupies plus the lines it wraps into. */
export interface TextLayout {
  /** The text box width, in world units. */
  width: number;
  /** The text box height: rendered lines × font size × TEXT_LINE_HEIGHT. */
  height: number;
  /** The rendered lines, after wrapping each explicit line. */
  lines: string[];
  /** Measured width of each rendered line (parallel to `lines`). */
  lineWidths: number[];
  /** How many explicit newlines there are + 1 (an empty text is one line). */
  hardLines: number;
  /** True when at least one explicit line had to wrap. */
  wrapped: boolean;
}

/** Character-count estimate of a line's width, when no canvas is available. */
export function estimateTextWidth(text: string, fontPx: number): number {
  return text.length * fontPx * TEXT_AVG_GLYPH_WIDTH_RATIO;
}

type Ctx2D = { font: string; measureText(t: string): { width: number } };

/**
 * A `Measurer` backed by a real canvas `measureText`, so wrapping matches how the
 * browser will lay the text out. The canvas is created once and reused. When no
 * canvas / OffscreenCanvas is available (jsdom, TC-32) it falls back to a
 * character-count estimate and never throws.
 */
export function createCanvasMeasurer(
  fontFamily: string = TEXT_FONT_FAMILY,
): Measurer {
  let ctx: Ctx2D | null = null;
  let tried = false;

  const acquire = (): Ctx2D | null => {
    if (tried) return ctx;
    tried = true;
    // Only `OffscreenCanvas`: it needs no document, is present in every browser this
    // app runs in, and a DOM `<canvas>` in an environment without canvas support (a
    // test runner, a server render) logs a "not implemented" error just by asking it,
    // which is exactly the noise the estimate fallback exists to avoid.
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        const c = new OffscreenCanvas(1, 1);
        ctx = (c.getContext('2d') as unknown as Ctx2D) ?? null;
      }
    } catch {
      ctx = null;
    }
    return ctx;
  };

  return (text: string, fontPx: number): number => {
    const c = acquire();
    if (c) {
      c.font = `${fontPx}px ${fontFamily}`;
      return c.measureText(text).width;
    }
    return estimateTextWidth(text, fontPx);
  };
}

/**
 * Greedy word wrap: pack whole words onto a line while it stays within `maxWidth`;
 * a word alone wider than `maxWidth` is kept whole on its own line (never broken),
 * which is what a `word-break: normal` browser does too. An empty line yields one
 * empty line (so a blank line still counts toward the height).
 */
function wrapLine(
  line: string,
  fontPx: number,
  maxWidth: number,
  measure: Measurer,
): string[] {
  if (line === '') return [''];
  const words = line.split(' ');
  const out: string[] = [];
  let cur = '';
  for (const word of words) {
    const candidate = cur === '' ? word : `${cur} ${word}`;
    if (cur === '' || measure(candidate, fontPx) <= maxWidth) {
      cur = candidate;
    } else {
      out.push(cur);
      cur = word;
    }
  }
  out.push(cur);
  return out;
}

/**
 * The line count to a height, in whole world units (text.height). Rounded so the
 * stored box is a whole number of units — a box that differs from its own rounded
 * measurement by a third decimal would otherwise be rewritten on every edit.
 */
function heightFor(lineCount: number, fontPx: number): number {
  return Math.round(Math.max(1, lineCount) * fontPx * TEXT_LINE_HEIGHT);
}

/**
 * Compute a text object's box and wrapped lines.
 *
 * `mode`:
 *  - 'auto':  a line up to TEXT_MAX_AUTO_WIDTH_WORLD wide stays on one line and the
 *             box hugs its longest line (+ TEXT_AUTO_WIDTH_PADDING_WORLD of air, never
 *             past the cap); a wider line word-wraps and the box is then exactly the
 *             cap — the 600-unit box the PRD describes.
 *  - 'fixed': width = `fixedWidth` (clamped up to TEXT_MIN_WIDTH_WORLD); text rewraps.
 *
 * Height is always the rendered line count × font size × TEXT_LINE_HEIGHT, so a text
 * object's height can never be set directly (text.height).
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = TEXT_SIZES[size];
  const hardLines = text.split('\n');

  let lines: string[] = [];
  let wrapped = false;

  if (mode === 'fixed') {
    const width = Math.max(TEXT_MIN_WIDTH_WORLD, fixedWidth ?? TEXT_MIN_WIDTH_WORLD);
    for (const hard of hardLines) {
      const part = wrapLine(hard, fontPx, width, measure);
      if (part.length > 1) wrapped = true;
      lines = lines.concat(part);
    }
    return finish(lines, hardLines.length, wrapped, width, fontPx, measure);
  }

  // auto: wrap only lines that are wider than the cap, and hug the content otherwise.
  const cap = TEXT_MAX_AUTO_WIDTH_WORLD;
  let widest = 0;
  for (const hard of hardLines) {
    const w = measure(hard, fontPx);
    if (w <= cap) {
      lines.push(hard);
      if (w > widest) widest = w;
    } else {
      wrapped = true;
      lines = lines.concat(wrapLine(hard, fontPx, cap, measure));
    }
  }
  // Once any line wrapped the box is filled to the cap; otherwise it hugs the text.
  const width = wrapped
    ? cap
    : Math.min(Math.max(widest + TEXT_AUTO_WIDTH_PADDING_WORLD, TEXT_MIN_WIDTH_WORLD), cap);
  return finish(lines, hardLines.length, wrapped, width, fontPx, measure);
}

/**
 * Assemble the result. The height comes from the rendered line count and the font
 * size alone, which is what makes a text object's height impossible to set directly.
 */
function finish(
  lines: string[],
  hardLines: number,
  wrapped: boolean,
  width: number,
  fontPx: number,
  measure: Measurer,
): TextLayout {
  return {
    width,
    height: heightFor(lines.length, fontPx),
    lines,
    lineWidths: lines.map((line) => measure(line, fontPx)),
    hardLines,
    wrapped,
  };
}
