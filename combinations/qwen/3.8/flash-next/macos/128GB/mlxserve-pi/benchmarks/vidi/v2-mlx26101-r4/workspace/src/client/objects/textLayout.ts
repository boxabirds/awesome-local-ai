/**
 * How much room a piece of text takes: measurement, wrapping and the resulting box.
 *
 * This lives on the client side of the line because it asks the browser a question — "how wide are these
 * words in this font" — and only the browser can answer it. The document model in `shared/objects/text.ts`
 * stores the answer; it does not compute one.
 *
 * **Why one client answers for everybody.** Font rendering differs enough between machines that two clients
 * measuring the same heading would store two different boxes for it, and a box is what the marquee, the
 * selection frame and anyone's export are drawn from. A board where the frame around a heading depends on
 * whose laptop is looking at it is a board that argues with itself. So the client that changes the text
 * measures it, writes the box, and everyone else draws the box they were given. See Key decision 1 of the
 * design.
 *
 * **Why the box is word-wrap and not free-positioned.** It is the same reason a paragraph is a paragraph:
 * one box whose height is counted in lines is a box a person can predict, and the height falls out of the
 * line count times the line height rather than out of a second measurement nobody asked for.
 */
import type * as Y from 'yjs';

import { LOCAL_ORIGIN, moveObjects } from '../../shared/board-model';
import type { Point, Rect } from '../../shared/geometry';
import {
  MAX_OBJECT_SIZE_WORLD,
  MAX_TEXT_BOX_WIDTH_WORLD,
  MIN_TEXT_CONTENT_WIDTH_WORLD,
  TEXT_ESTIMATED_GLYPH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_PADDING_WORLD,
  TEXT_SIZES,
} from '../../shared/config';
import type { TextSize } from '../../shared/config';
import {
  readText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
  textSizeOf,
  textLineHeight,
} from '../../shared/objects/text';
import type { TextWidthMode } from '../../shared/objects/text';

export { textLineHeight };

/**
 * How far a dragged width has to be from the one on record before the drag counts as a change of width.
 *
 * A group resize hands every object in the selection a rect, and rounding means the width that comes back is
 * rarely the one that went in to the byte. Anything smaller than a hundredth of a world unit is the same
 * width wearing a different last digit, and is treated as no request at all — see {@link resizeTextBox}.
 */
const WIDTH_EPSILON = 0.01;

/** How much space a line of text needs. Both numbers are world units, like everything else on the board. */
export interface TextMeasurement {
  width: number;
  height: number;
}

/**
 * A measurement of one line at one size.
 *
 * It is a function rather than a class because there is exactly one thing to ask and nothing to remember
 * between asks — and because the tests need to hand over a measurement they control. A measurer is allowed
 * to cache; it is not allowed to be the only source of truth, which is why every caller has a default of the
 * real one and can pass something else.
 */
export type TextMeasurer = (line: string, size: TextSize) => TextMeasurement;

/** The box a piece of text needs, in world units, and how many lines it came to. */
export interface TextLayout {
  /** The width of the *box*: the words, plus the padding the box carries on each side. */
  width: number;
  /** `lines` line heights, which is what the box is drawn at and what the resize handle scales against. */
  height: number;
  /** Explicit newlines plus however many the wrapping added. At least one, always. */
  lines: number;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * A width guessed from the number of characters, for the places that have no canvas to ask.
 *
 * A server validating a document, a test environment without canvas support, a browser that refused to give
 * us a 2d context: all of them need *a* box rather than no box, because a box of zero takes the object out
 * of every hit test on the board. It is a guess about Latin text in a normal font and nothing more — it is
 * never what decides where a line breaks on somebody's screen, and it is deliberately wider than narrow for
 * the scripts this ratio knows nothing about.
 */
export function estimateTextWidth(line: string, size: TextSize): number {
  const text = typeof line === 'string' ? line : '';
  return text.length * TEXT_SIZES[textSizeOf(size)] * TEXT_ESTIMATED_GLYPH_RATIO;
}

/** The measurer used when there is nothing better: the estimate, in the shape a measurer has. */
export const estimateMeasurer: TextMeasurer = (line, size) => ({
  width: estimateTextWidth(line, size),
  height: TEXT_SIZES[textSizeOf(size)],
});

/** How tall `lines` lines are at this size. The box is this tall, and the editor checks itself against it. */
export function measureTextHeight(lines: number, size: TextSize): number {
  const count = Number.isFinite(lines) && lines >= 1 ? Math.floor(lines) : 1;
  return count * textLineHeight(textSizeOf(size));
}

/**
 * A measurer backed by a real canvas context, or null where there is no canvas.
 *
 * The font string is built from `TEXT_FONT_FAMILY`, the same string the text is drawn with, and it has to
 * be: measuring in one font and drawing in another is how a box ends up with words hanging out of it. The
 * canvas is created once and kept, never attached to the document.
 *
 * Results are cached per line and size, because typing a heading character by character asks the same
 * question about the same prefixes over and over; the cache is dropped when it gets large rather than
 * eviction-managed, since a board that has measured ten thousand different strings is a board where the old
 * answers no longer matter.
 */
export function createCanvasMeasurer(): TextMeasurer | null {
  if (typeof document === 'undefined') return null;

  let context: CanvasRenderingContext2D | null = null;
  try {
    context = document.createElement('canvas').getContext('2d');
  } catch {
    // jsdom and anything like it: no canvas at all. The estimate is what the board measures with there,
    // and no test of behaviour should care which of the two answered.
    return null;
  }
  if (context === null) return null;

  const cache = new Map<string, TextMeasurement>();

  return (line: string, size: TextSize): TextMeasurement => {
    const fontPx = TEXT_SIZES[textSizeOf(size)];
    const key = `${fontPx}|${line}`;
    const known = cache.get(key);
    if (known !== undefined) return known;

    context.font = `${fontPx}px ${TEXT_FONT_FAMILY}`;
    const metrics = context.measureText(typeof line === 'string' ? line : '');
    const ascent = (metrics as TextMetrics).actualBoundingBoxAscent;
    const descent = (metrics as TextMetrics).actualBoundingBoxDescent;

    const measured: TextMeasurement = {
      width: finite(metrics.width) ? metrics.width : estimateTextWidth(line, size),
      height: finite(ascent) && finite(descent) && ascent + descent > 0 ? ascent + descent : fontPx,
    };

    if (cache.size > 10_000) cache.clear();
    cache.set(key, measured);
    return measured;
  };
}

let defaultMeasurer: TextMeasurer | null = null;

/**
 * The measurer the board uses when a caller does not bring one: the canvas one where there is a canvas, the
 * estimate where there is not.
 *
 * Created on first use rather than at import, because the module is imported by tests that run before any
 * document exists, and by a server that never will.
 */
export function getMeasurer(): TextMeasurer {
  if (defaultMeasurer === null) defaultMeasurer = createCanvasMeasurer() ?? estimateMeasurer;
  return defaultMeasurer;
}

/**
 * Measure with something else — the layout tests' fake, or a component test that wants a box it can predict
 * to the pixel. Pass null to give the board its own measurer back.
 *
 * This exists so a test can be exact without being flaky. It is not a knob for production code: a board
 * whose boxes come from a measurement nobody recognises is a board that looks subtly wrong in ways nobody
 * can reproduce.
 */
export function setMeasurer(measurer: TextMeasurer | null): void {
  defaultMeasurer = measurer;
}

/** How much room the words get inside a box of this width. */
export function contentWidthOf(width: number): number {
  if (!finite(width)) return MIN_TEXT_CONTENT_WIDTH_WORLD;
  return Math.max(width - TEXT_PADDING_WORLD * 2, MIN_TEXT_CONTENT_WIDTH_WORLD);
}

/** The room words are laid out in: the cap in auto mode, the dragged width minus padding in fixed mode. */
function wrapLimitOf(widthMode: TextWidthMode, fixedWidth: number | null): number {
  if (widthMode !== 'fixed') return TEXT_MAX_AUTO_WIDTH_WORLD;
  if (!finite(fixedWidth)) return MIN_TEXT_CONTENT_WIDTH_WORLD;
  return contentWidthOf(clamp(fixedWidth, TEXT_MIN_WIDTH_WORLD, MAX_OBJECT_SIZE_WORLD));
}

/** The width of a line, from a measurer that may be lying about it. */
function widthOf(measure: TextMeasurer, size: TextSize, line: string): number {
  const measured = measure(line, size);
  const width = measured?.width;
  // A measurement that is not a number is treated as no width at all. Letting NaN through would put the box
  // — and so the object's place in every hit test and selection on the board — out of existence.
  return finite(width) && width > 0 ? width : 0;
}

/**
 * Break one explicit line into the lines it is drawn as, by the greedy rule: keep adding words while they
 * still fit, break at the first word that does not.
 *
 * Greedy rather than optimal (Knuth–Plass, minimum raggedness) because greedy is what a text area does, and
 * the DOM is the oracle for what the person sees: an algorithm that produced prettier but different line
 * breaks would mean the box is sized by one algorithm and the words are broken by another, which is words
 * spilling out of the frame. A word longer than the room available is left alone on its line — words are
 * never broken, and the box simply does not get any wider than it already was.
 */
function wrapLine(line: string, limit: number, measure: TextMeasurer, size: TextSize): string[] {
  if (line === '') return [''];

  const space = widthOf(measure, size, ' ');
  const lines: string[] = [];
  let current: string[] = [];
  let currentWidth = 0;

  for (const word of line.split(' ')) {
    const wordWidth = widthOf(measure, size, word);

    if (current.length === 0) {
      current = [word];
      currentWidth = wordWidth;
      continue;
    }

    const joined = currentWidth + space + wordWidth;
    if (joined <= limit) {
      current.push(word);
      currentWidth = joined;
    } else {
      lines.push(current.join(' '));
      current = [word];
      currentWidth = wordWidth;
    }
  }

  if (current.length > 0) lines.push(current.join(' '));
  return lines;
}

/** Every explicit line of a piece of text, with `\r\n` and `\r` counting as one break each. */
function explicitLines(text: string): string[] {
  const normalized = typeof text === 'string' ? text.replaceAll('\r\n', '\n').replaceAll('\r', '\n') : '';
  return normalized.split('\n');
}

/**
 * The box a piece of text needs.
 *
 * In **auto** mode the width is the widest explicit line, plus the padding the box carries on both sides,
 * held down to the narrowest box the board accepts and up to the widest box it allows: a heading is as wide
 * as it is, a paragraph is as wide as it is until it is as wide as the board allows, and after that it grows
 * downwards. In **fixed** mode the width is the width the person dragged, because that is a thing they chose
 * and a box that decided to be narrower on the next keystroke would be taking the choice back.
 *
 * The height is the number of lines — explicit newlines plus the ones the wrapping needed — times the line
 * height for the size. That is why a resize keeps the width and recomputes the height: with wrap layout the
 * height is a consequence of the width, and inventing an independent one would be a box that is either too
 * tall or cut off.
 */
export function layoutText(
  text: string,
  size: TextSize,
  widthMode: TextWidthMode,
  fixedWidth: number | null,
  measure: TextMeasurer = getMeasurer(),
): TextLayout {
  const textSize = textSizeOf(size);
  const limit = wrapLimitOf(widthMode === 'fixed' ? 'fixed' : 'auto', fixedWidth);
  const measureOf = typeof measure === 'function' ? measure : estimateMeasurer;

  let widestLine = 0;
  let lines = 0;
  for (const line of explicitLines(text)) {
    widestLine = Math.max(widestLine, widthOf(measureOf, textSize, line));
    lines += wrapLine(line, limit, measureOf, textSize).length;
  }

  const width =
    widthMode === 'fixed'
      ? clamp(finite(fixedWidth) ? fixedWidth : TEXT_MIN_WIDTH_WORLD, TEXT_MIN_WIDTH_WORLD, MAX_OBJECT_SIZE_WORLD)
      : clamp(widestLine + TEXT_PADDING_WORLD * 2, TEXT_MIN_WIDTH_WORLD, MAX_TEXT_BOX_WIDTH_WORLD);

  return Object.freeze({
    width,
    height: measureTextHeight(lines, textSize),
    lines,
  });
}

/**
 * Choose a size, and give the words the box they need at it, as one change.
 *
 * The size and the box go into one transaction on purpose. Split across two, one Ctrl+Z would take the
 * letters back to their old size and leave the box the new one — a heading drawn small inside a frame
 * drawn large, which is a thing nobody did. The outer transaction is also the only way to get this:
 * `setTextSize` and `setTextBox` each open their own, and Yjs folds a nested transaction into the one
 * already open rather than logging a second step.
 *
 * Returns false when there is no such text object or the size was already the size, and then nothing at
 * all is written — not even a box.
 */
export function changeTextSize(
  doc: Y.Doc,
  id: string,
  size: TextSize,
  measure: TextMeasurer = getMeasurer(),
): boolean {
  let changed = false;
  doc.transact(() => {
    if (!setTextSize(doc, id, size)) return;
    changed = true;
    remeasureTextBox(doc, id, measure);
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Take a rect somebody dragged and make it this text object's box, as one change.
 *
 * A drag of a side handle says two things at once: *here*, and *this wide*. The first is a move like any
 * other object's; the second is a width the person chose, which is what `setTextWidthFixed` stores and
 * what the words are then laid out inside. The height is not dragged at all — it is counted in lines, so
 * it comes from the layout, and a box dragged to a height its words do not fill would be a frame with
 * nothing in the bottom of it.
 *
 * All three writes are one transaction, so one undo puts the text back where it was, at the width it was
 * and with the lines it had, rather than half-restoring a drag.
 *
 * Returns whether the object took part in the resize; an id that is not a text object writes nothing.
 */
export function resizeTextBox(
  doc: Y.Doc,
  id: string,
  rect: Rect,
  measure: TextMeasurer = getMeasurer(),
): boolean {
  if (!Number.isFinite(rect?.x) || !Number.isFinite(rect?.y) || !Number.isFinite(rect?.width)) return false;

  let changed = false;
  const at: Point = { x: rect.x, y: rect.y };
  doc.transact(() => {
    if (moveObjects(doc, new Map([[id, at]])) > 0) changed = true;
    // The width is only *pinned* when the drag actually pulled it. A group resize that moved this object, or
    // dragged it from a side it does not answer to, hands over the width it already has — and taking the
    // word literally there would turn an auto-width heading into a fixed-width one on a drag that was never
    // about its width, freezing wrap points nobody chose.
    const read = readText(doc, id);
    if (read !== null && Math.abs(read.width - rect.width) > WIDTH_EPSILON) {
      if (setTextWidthFixed(doc, id, rect.width)) changed = true;
    }
    // The height is whatever this width makes of the words, which is the whole reason a text object has a
    // resize path of its own instead of taking the board's scaling of a rect.
    if (remeasureTextBox(doc, id, measure) !== null) changed = true;
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Work out a text object's box again and write it.
 *
 * This is the one function that both measures and stores, and it is called only from places where a change
 * happened *here*: after a local keystroke, after a size change, after a drag, and after an undo or redo that
 * put words back that this client cannot see the layout of. It is never called for a change that arrived
 * from somebody else — their box is already in the document, and a second answer to the same question is
 * churn, one message per keystroke per client, each overwriting the last.
 *
 * Returns the layout it wrote, or null when there is no such text object. It does not open the caller's
 * transaction: a caller that is already changing something (a size change, a resize) wants the box written in
 * the same transaction as that change, so that one undo brings both back together.
 */
export function remeasureTextBox(doc: Y.Doc, id: string, measure: TextMeasurer = getMeasurer()): TextLayout | null {
  const read = readText(doc, id);
  if (read === null) return null;

  const laid = layoutText(
    read.text,
    read.size,
    read.widthMode,
    read.widthMode === 'fixed' ? read.width : null,
    measure,
  );
  setTextBox(doc, id, { width: laid.width, height: laid.height });
  return laid;
}
