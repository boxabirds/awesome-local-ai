/**
 * Measuring and wrapping text: the one place that turns characters into a box
 * (`text.layout`).
 *
 * Nothing else on the client needs to know how wide a word is. The text object writes
 * the answer into the document (`setTextBox`) so that selection, marquee and resize —
 * code that knows nothing about fonts — can treat text like any other object, and the
 * text object itself draws from the same stored box.
 *
 * Two rules make this worth its own file:
 *
 *  - **the box is the text.** An `auto` box is as wide as its longest line, so there is
 *    no mystery gap around a short word; it stops growing at
 *    `TEXT_MAX_AUTO_WIDTH_WORLD` and lines wrap inside that. A `fixed` box is whatever
 *    width the user dragged it to — never less than `TEXT_MIN_WIDTH_WORLD`, because a
 *    box narrower than a word has no handle left to grab — and it keeps it even when
 *    the content gets shorter. Height is never a user's choice: it is always the number
 *    of lines it takes, so a box is as tall as the text it holds and never a pixel more.
 *  - **measurement is a function, not a fact.** Fonts are the one part of layout a
 *    browser will not tell you about without drawing, so every measurement here comes
 *    through an injected {@link Measurer}: a canvas in a browser, arithmetic in a test,
 *    and arithmetic again in a browser that cannot give us a canvas at all (TC-32). A
 *    wrong measurement makes a box the wrong size, which is survivable; a throw in the
 *    middle of typing would lose somebody's words.
 *
 * The wrapping is greedy word wrapping, and a word too long for the box is cut at the
 * last character that fits — because a `<textarea>` cuts it too, and a stored box that
 * disagrees with what is on the screen is a box that selects the wrong area.
 */

import {
  DEFAULT_TEXT_SIZE,
  TEXT_FONT_FAMILY,
  TEXT_GLYPH_WIDTH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize
} from '../../shared/config';
import { isTextSize, type TextWidthMode } from '../../shared/objects/text';

/** How wide `text` is, drawn at `fontPx`. */
export type Measurer = (text: string, fontPx: number) => number;

export interface TextLayout {
  /** The width of the box: the widest line, or the width the user gave. */
  width: number;
  /** `lines.length` lines of text, at the size's line height. */
  height: number;
  /** What the text becomes once wrapped — every character of it, on some line. */
  lines: string[];
}

/** The font size of one of the four sizes; an unknown size is the default size. */
export function fontPxFor(size: TextSize | string): number {
  return isTextSize(size) ? TEXT_SIZES[size] : TEXT_SIZES[DEFAULT_TEXT_SIZE];
}

/**
 * Guess how wide text is when there is no way to measure it: every character the same
 * width, `TEXT_GLYPH_WIDTH_RATIO` of the font size.
 *
 * This is the fallback for a browser that will not hand out a 2D drawing surface, and
 * it is what the tests measure with. It is a guess in the right shape — proportional to
 * the text and to the size — which keeps a box usable, so a user can still select, move
 * and read their text. It is not a guess that fits mixed-width text like `iiii` and
 * `WWWW`, and nothing pretends otherwise.
 */
export function estimateTextWidth(text: string, fontPx: number): number {
  // Counted in code points, not UTF-16 units: an emoji is one wide character, not two.
  let characters = 0;
  for (const _character of text) characters += 1;
  return characters * fontPx * TEXT_GLYPH_WIDTH_RATIO;
}

/** The part of a 2D drawing context this module uses. */
interface TextSurface {
  font: string;
  measureText(text: string): { width: number };
}

function acquireSurface(fontFamily: string): TextSurface | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const context = new OffscreenCanvas(1, 1).getContext('2d');
      if (context) return context as unknown as TextSurface;
    }
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const canvas = document.createElement('canvas');
      const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
      if (context) return context as unknown as TextSurface;
    }
  } catch {
    // No surface, for whatever reason the browser wants to keep to itself.
  }
  void fontFamily;
  return null;
}

/**
 * A measurer that asks a real canvas, falling back to {@link estimateTextWidth} when
 * there is no canvas to ask (TC-32) — and, this being a browser, when the answer is
 * nonsense: a `NaN` or a negative width from a half-initialised context is treated as
 * "no answer" rather than written into the document.
 *
 * The surface is acquired on the first measurement, not at import: importing this
 * module should not need a DOM, and the first measurement happens when a text object
 * first draws.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  let surface: TextSurface | null | undefined;
  let fontApplied = '';
  return (text, fontPx) => {
    if (surface === undefined) surface = acquireSurface(fontFamily);
    if (!surface) return estimateTextWidth(text, fontPx);
    const font = `${fontPx}px ${fontFamily}`;
    try {
      if (font !== fontApplied) {
        surface.font = font;
        fontApplied = font;
      }
      const width = surface.measureText(text).width;
      return Number.isFinite(width) && width >= 0 ? width : estimateTextWidth(text, fontPx);
    } catch {
      return estimateTextWidth(text, fontPx);
    }
  };
}

let sharedMeasurer: Measurer | null = null;
let injectedMeasurer: Measurer | null = null;

/**
 * The measurer the board uses. One for the whole app: acquiring a canvas per measurement
 * would be silly, and two measurers with different fonts would give two boxes for one
 * piece of text.
 */
export function getTextMeasurer(): Measurer {
  if (injectedMeasurer) return injectedMeasurer;
  if (!sharedMeasurer) sharedMeasurer = createCanvasMeasurer();
  return sharedMeasurer;
}

/**
 * Measure text some other way — which is what the component tests do, because jsdom has
 * no canvas and no text metrics, so a component test that measured for real would be
 * asserting nothing. Pass `null` to go back to the browser's own measurement.
 */
export function setTextMeasurer(measure: Measurer | null): void {
  injectedMeasurer = measure;
  sharedMeasurer = null;
}

/**
 * Split one line of text into the lines it becomes inside `maxWidth`.
 *
 * Greedy, on spaces: the longest run of words that fits takes the line. A single word
 * wider than the box is cut at the last character that still fits, because that is what
 * a text box on screen does to a long word, and this wrapping has to agree with the
 * drawing.
 */
function wrapLine(line: string, fontPx: number, maxWidth: number, measure: Measurer): string[] {
  if (line === '') return [''];
  if (measure(line, fontPx) <= maxWidth) return [line];

  const lines: string[] = [];
  let current = '';

  for (const word of line.split(' ')) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (measure(candidate, fontPx) <= maxWidth) {
      current = candidate;
      continue;
    }
    // The words so far fill this line; they move on, and this one starts the next.
    if (current !== '') lines.push(current);
    current = '';
    if (word === '') continue; // a run of spaces, absorbed by the break
    if (measure(word, fontPx) <= maxWidth) {
      current = word;
      continue;
    }
    // A word that cannot fit at all: cut it where the box ends. Iterating the string
    // walks code points, so the cut never falls inside an emoji.
    let chunk = '';
    for (const character of word) {
      const next = chunk + character;
      if (chunk !== '' && measure(next, fontPx) > maxWidth) {
        lines.push(chunk);
        chunk = character;
      } else {
        chunk = next;
      }
    }
    current = chunk;
  }

  if (current !== '' || lines.length === 0) lines.push(current);
  return lines;
}

/**
 * The box for `text` at `size`, in `mode` (`text.layout`, `text.auto_width`,
 * `text.fixed_width`).
 *
 * `fixedWidth` only means anything in `fixed` mode — the width the user dragged the box
 * to — and is clamped up to `TEXT_MIN_WIDTH_WORLD` there. In `auto` mode the width is
 * the longest line, clamped into `[TEXT_MIN_WIDTH_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD]`:
 * the floor so an empty or tiny text still has a box you can click, the ceiling because
 * a line that runs the width of the board is unreadable.
 *
 * Both newline kinds are line breaks, and a wrapped line counts as many lines as it
 * takes; the height is that count times the size's line height, which is why the height
 * of a text box is never dragged anywhere.
 */
export function layoutText(
  text: string,
  size: TextSize | string,
  mode: TextWidthMode,
  fixedWidth: number | undefined,
  measure: Measurer
): TextLayout {
  const fontPx = fontPxFor(size);
  const hardLines = typeof text === 'string' ? text.split('\n') : [''];

  let width: number;
  if (mode === 'fixed') {
    width = Math.max(TEXT_MIN_WIDTH_WORLD, Number.isFinite(fixedWidth) ? (fixedWidth as number) : TEXT_MIN_WIDTH_WORLD);
  } else {
    let longest = 0;
    for (const line of hardLines) longest = Math.max(longest, measure(line, fontPx));
    width = Math.min(Math.max(longest, TEXT_MIN_WIDTH_WORLD), TEXT_MAX_AUTO_WIDTH_WORLD);
  }

  const lines: string[] = [];
  for (const line of hardLines) lines.push(...wrapLine(line, fontPx, width, measure));

  return { width, height: lines.length * fontPx * TEXT_LINE_HEIGHT, lines };
}

/**
 * The box for a piece of text — the same measurement as {@link layoutText}, under the
 * name the board calls.
 */
export const measureText = layoutText;
