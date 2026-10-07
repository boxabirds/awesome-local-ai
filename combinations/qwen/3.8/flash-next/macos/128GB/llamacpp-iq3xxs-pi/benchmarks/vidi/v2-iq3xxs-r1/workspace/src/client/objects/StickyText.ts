import type * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';

// ---------------------------------------------------------------------------
// Sticky note text helpers. Everything except `fitFontSize` is pure, so the
// length limit, the minimal Yjs diff (required so story 3's concurrent typing
// is never destroyed) and the counter rule are unit-tested without a DOM.
// ---------------------------------------------------------------------------

/**
 * Keep at most `max` characters; characters beyond the limit are dropped, so a
 * 1,200 character paste into an empty note stores exactly the first 1,000.
 * The cut never splits a surrogate pair.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (max < 0 || !Number.isFinite(max)) return '';
  if (next.length <= max) return next;
  let end = max;
  // Drop a trailing high surrogate so the limit cannot split an emoji.
  const code = next.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return next.slice(0, end);
}

/**
 * True when the note is within STICKY_COUNTER_THRESHOLD_CHARS of the limit and
 * the "n/1000" counter should be shown.
 */
export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length;
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS;
}

const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** Start index of the code point that contains the unit at `index`. */
function codePointStart(s: string, index: number): number {
  const code = s.charCodeAt(index);
  return isLowSurrogate(code) && index > 0 ? index - 1 : index;
}

/** Common prefix length in UTF-16 units, never splitting a surrogate pair. */
function commonPrefixUnits(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length) {
    const ca = a.codePointAt(i)!;
    const cb = b.codePointAt(i)!;
    if (ca !== cb) break;
    i += ca > 0xffff ? 2 : 1;
  }
  return i;
}

/** Common suffix length in UTF-16 units, capped and pair-safe. */
function commonSuffixUnits(a: string, b: string, max: number): number {
  let units = 0;
  let ia = a.length - 1;
  let ib = b.length - 1;
  while (units < max && ia >= 0 && ib >= 0) {
    const startA = codePointStart(a, ia);
    const startB = codePointStart(b, ib);
    const chunkA = a.slice(startA, ia + 1);
    const chunkB = b.slice(startB, ib + 1);
    if (chunkA !== chunkB) break;
    units += ia - startA + 1;
    ia = startA - 1;
    ib = startB - 1;
  }
  return units;
}

/**
 * Write `next` into `ytext` with the smallest possible change: at most one
 * delete and one insert, found from the common prefix and suffix. A full
 * replace would overwrite text other users typed between our cursor and the
 * sync (story 3), which is exactly what the minimal diff protects.
 *
 * A no-op performs no transaction, so it emits no update (no sync traffic).
 */
export function applyTextDiff(
  ytext: Y.Text,
  next: string,
  origin: unknown = LOCAL_ORIGIN,
): void {
  const prev = ytext.toString();
  if (prev === next) return;

  const prefix = commonPrefixUnits(prev, next);
  const suffix = commonSuffixUnits(prev, next, Math.min(prev.length, next.length) - prefix);
  const deleteLength = prev.length - prefix - suffix;
  const insertText = next.slice(prefix, next.length - suffix);

  const run = (): void => {
    if (deleteLength > 0) ytext.delete(prefix, deleteLength);
    if (insertText.length > 0) ytext.insert(prefix, insertText);
  };

  const doc = ytext.doc;
  if (doc) doc.transact(run, origin);
  else run();
}

export interface FontFit {
  fontPx: number;
  overflow: boolean;
}

/**
 * Padding inside a note, in world units; mirrors `.sticky-text` in index.css.
 * A note is a square (`STICKY_SIZE_WORLD`), so one padding constant gives the
 * text box in both directions.
 */
export const STICKY_TEXT_PADDING_WORLD = 16;
export const STICKY_TEXT_BOX_WORLD = STICKY_SIZE_WORLD - STICKY_TEXT_PADDING_WORLD * 2;

/** Returns the height the note text would occupy at `fontPx`. */
export type MeasureFont = (fontPx: number) => number;

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at
 * which the text still fits into `boxPx` (binary search over the 15 candidate
 * sizes). When even the smallest size does not fit, `overflow` is true: the
 * caller clips the text inside the note and shows the bottom fade.
 *
 * `measure(fontPx)` does the layout work, so the search itself is pure and
 * testable, and only the text and the candidate size are involved — never zoom.
 */
export function fitTextFontSize(
  text: string,
  measure: MeasureFont,
  boxPx = STICKY_TEXT_BOX_WORLD,
): FontFit {
  if (text.trim() === '') return { fontPx: STICKY_FONT_MAX_PX, overflow: false };

  const fits = (size: number): boolean => {
    // A height of 0 means "not measurable" (detached element, or jsdom, which
    // has no layout): treat that as fitting, so the maximum size is chosen.
    const height = measure(size);
    return height === 0 || height <= boxPx;
  };

  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  let best = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (best < 0) return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  return { fontPx: best, overflow: false };
}

/**
 * A `MeasureFont` backed by a real element: set the font size, then read the
 * height the wrapped text occupies. `getComputedStyle` is deliberately not used
 * — reading it per candidate size is far slower than `scrollHeight`.
 */
export function measureElementHeight(el: HTMLElement): MeasureFont {
  return (fontPx: number) => {
    const previous = el.style.fontSize;
    el.style.fontSize = `${fontPx}px`;
    const height = el.scrollHeight;
    if (previous) el.style.fontSize = previous;
    else el.style.removeProperty('font-size');
    return height;
  };
}

/**
 * `fitTextFontSize` for a note that is in the document: the text is read from
 * `el`, measured through `el` itself, and the chosen size is applied to `el` so
 * the measurement and the result can never disagree.
 */
export function fitFontSize(el: HTMLElement, boxPx = STICKY_TEXT_BOX_WORLD): FontFit {
  const fit = fitTextFontSize(el.textContent ?? '', measureElementHeight(el), boxPx);
  el.style.fontSize = `${fit.fontPx}px`;
  return fit;
}
