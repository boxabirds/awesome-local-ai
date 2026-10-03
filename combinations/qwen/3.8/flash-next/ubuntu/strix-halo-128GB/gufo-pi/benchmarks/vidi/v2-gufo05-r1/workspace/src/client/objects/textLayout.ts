/**
 * Measuring text: how wide a box it needs, and how many lines it comes to.
 *
 * Two things make this more than `text.length * something`:
 *
 * - **A browser wraps text, and it has to wrap it the same way twice.** The box a
 *   text object stores is the box it is drawn in (`white-space: pre-wrap` at that
 *   width), so the layout here has to agree with what the browser does with the
 *   same text at the same width — otherwise a remote client, which never measures,
 *   would draw the same object with different line breaks than the person who typed
 *   it. Greedy fill (put a word on the line while it fits, then start a new line) is
 *   the rule browsers use, so it is the rule here; a word that cannot fit on a line
 *   of its own is broken, which is what `overflow-wrap: break-word` does.
 * - **Measurement needs a browser, and not everything that runs this has one.**
 *   `createCanvasMeasurer` returns a real measurer where `document` exists and an
 *   estimate where it does not (`text.layout`): a jsdom without a canvas, a Worker,
 *   a server render. The estimate is a character count, and is deliberately not
 *   what a person with a browser sees — it is what a board does rather than breaks
 *   when measurement is unavailable.
 *
 * The measurer is a parameter for the same reason `Camera` is one in story 1: the
 * arithmetic is then a pure function of its inputs and can be tested exactly
 * (`tests/unit/text-layout.test.ts`).
 */
import {
  DEFAULT_TEXT_SIZE,
  TEXT_BOX_SLACK_WORLD,
  TEXT_FALLBACK_GLYPH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';
import { isFiniteNumber } from '../../shared/util';

/** The width of `text` in world units, drawn at `fontPx` board units of font. */
export type Measurer = (text: string, fontPx: number) => number;

/** What a piece of text needs: a box, and the lines it breaks into. */
export interface TextLayout {
  readonly width: number;
  readonly height: number;
  readonly lines: readonly string[];
}

/** How wide text is when there is nothing to measure it with. */
export function estimateTextWidth(text: string, fontPx: number): number {
  return text.length * fontPx * TEXT_FALLBACK_GLYPH_RATIO;
}

/** A 2D context to measure with, or null where there is no browser. */
function measuringContext(): CanvasRenderingContext2D | null {
  try {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    const canvas = document.createElement('canvas');
    return canvas.getContext('2d') ?? null;
  } catch {
    // jsdom without the canvas package throws here rather than returning null.
    return null;
  }
}

/**
 * A measurer that uses the browser's own text metrics, falling back to an estimate.
 *
 * It never throws and never returns something that is not a width: a font that is
 * still loading, a canvas that is unavailable, or a browser that gives back `NaN`
 * should make the box slightly wrong, not make the object disappear.
 *
 * The context is made once and reused; setting `font` per call is cheap, and
 * creating a canvas per keystroke is not.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  const context = measuringContext();
  if (!context) return estimateTextWidth;

  return (text, fontPx) => {
    if (text === '') return 0;
    try {
      context.font = `${fontPx}px ${fontFamily}`;
      const width = context.measureText(text).width;
      return isFiniteNumber(width) ? width : estimateTextWidth(text, fontPx);
    } catch {
      return estimateTextWidth(text, fontPx);
    }
  };
}

/** The font size of a preset, tolerating one this build does not know. */
function fontOf(size: TextSize): number {
  const fontPx = TEXT_SIZES[size] ?? TEXT_SIZES[DEFAULT_TEXT_SIZE];
  return isFiniteNumber(fontPx) && fontPx > 0 ? fontPx : TEXT_SIZES[DEFAULT_TEXT_SIZE];
}

/** Break one line of text into pieces no wider than `available`. */
function wrapLine(
  line: string,
  fontPx: number,
  available: number,
  measure: Measurer,
): string[] {
  if (line === '') return [''];

  const pieces: string[] = [];
  let current = '';

  const flush = () => {
    pieces.push(current);
    current = '';
  };
  /** Chop a word that is wider than the box, at least one character at a time. */
  const breakWord = (word: string) => {
    let chunk = '';
    for (const character of word) {
      if (chunk !== '' && measure(chunk + character, fontPx) > available) {
        pieces.push(chunk);
        chunk = character;
      } else {
        chunk += character;
      }
    }
    current = chunk;
  };

  // `split(' ')` keeps the empty word a double space makes, so the pieces
  // re-join into the line they came from.
  for (const word of line.split(' ')) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (measure(candidate, fontPx) <= available) {
      current = candidate;
      continue;
    }
    if (current !== '') flush();
    if (measure(word, fontPx) <= available) {
      current = word;
    } else {
      breakWord(word);
    }
  }
  if (current !== '' || pieces.length === 0) pieces.push(current);
  return pieces;
}

/**
 * Lay text out: the box it needs, and the lines it comes to.
 *
 * `mode` is the object's stored `widthMode`. In `auto` the box is as wide as its
 * widest line plus the box slack, up to `TEXT_MAX_AUTO_WIDTH_WORLD`; a line that
 * will not fit in that is wrapped, and the box then sits exactly at the maximum,
 * because that is the width the content was wrapped for. In `fixed` a person set
 * the width, so the box is that width and nothing else, however short the text is.
 *
 * Height is always lines × font × `TEXT_LINE_HEIGHT` — it follows the content in
 * both modes, so a box is never too short for what is in it (`text.box`).
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = fontOf(size);
  const holdsAWidth = mode === 'fixed' && isFiniteNumber(fixedWidth) && fixedWidth > 0;
  const available = holdsAWidth
    ? Math.max(fixedWidth as number, TEXT_MIN_WIDTH_WORLD)
    : TEXT_MAX_AUTO_WIDTH_WORLD;

  const lines: string[] = [];
  let wrapped = false;
  // Explicit newlines are respected: each source line is wrapped on its own, so a
  // blank line stays blank instead of joining its neighbours.
  for (const source of text.split('\n')) {
    const pieces = wrapLine(source, fontPx, available, measure);
    if (pieces.length > 1) wrapped = true;
    lines.push(...pieces);
  }

  let width: number;
  if (holdsAWidth) {
    width = available;
  } else if (wrapped) {
    // The content was wrapped for the maximum, so the box is the maximum: a box
    // shrunk to the widest wrapped line would be narrower than the width the lines
    // were broken at, and the browser would break them somewhere else again.
    width = TEXT_MAX_AUTO_WIDTH_WORLD;
  } else {
    let widest = 0;
    for (const line of lines) widest = Math.max(widest, measure(line, fontPx));
    width = Math.min(widest + TEXT_BOX_SLACK_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD);
  }

  return { width, height: lines.length * fontPx * TEXT_LINE_HEIGHT, lines };
}

/**
 * One measurer for the whole tab.
 *
 * A canvas context belongs to the document, not to an object, and `layoutText` is called
 * from more than one place — every text on screen, and the toolbars that resize them. They
 * should be measuring with the same instrument, in case the answer differs by a pixel.
 */
let shared: Measurer | null = null;
export function sharedMeasurer(): Measurer {
  if (shared === null) shared = createCanvasMeasurer();
  return shared;
}
