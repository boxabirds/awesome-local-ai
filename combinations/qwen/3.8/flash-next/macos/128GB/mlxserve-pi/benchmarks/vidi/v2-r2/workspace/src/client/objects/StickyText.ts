// Sticky note text logic: the parts that do not need a rendered page.
//   clampToLimit   the 1,000 character rule
//   applyTextDiff  the minimal Y.Text edit for a new textarea value
//   counterVisible when the "940/1000" counter appears
//   fitFontSize    the largest font size the note can show all text in
//
// applyTextDiff matters beyond neatness: story 3 merges concurrent typing, and a
// full replace would destroy what somebody else typed in the same note.
//
// Characters are counted as the user counts them (Unicode code points), so an
// emoji is one character and a cut at the limit can never split a surrogate pair.

import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/** Padding inside a note, in world units. CSS and the fit maths share this. */
export const NOTE_PADDING_WORLD = 12;

/** Keep at most `max` characters, dropping everything after them. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (!Number.isFinite(max) || max <= 0) return '';
  if (next.length <= max) return next; // cannot be too long by any count
  const chars = Array.from(next);
  if (chars.length <= max) return next; // long in code units, short in characters
  return chars.slice(0, max).join('');
}

/** True when the character counter should be shown for a text of this length. */
export function counterVisible(length: number): boolean {
  if (!Number.isFinite(length)) return false;
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/** UTF-16 offset of the `index`th character. */
function unitOffset(value: string, index: number): number {
  if (index <= 0) return 0;
  return Array.from(value).slice(0, index).join('').length;
}

/**
 * Make a Y.Text hold `next` with the smallest change that gets there: a common
 * prefix and suffix are left alone, so the event story 3 broadcasts is one small
 * insert/delete and another person's typing in the same note is untouched.
 * Does nothing (and opens no transaction) when the text already says `next`.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  const from = Array.from(current);
  const to = Array.from(next);

  let start = 0;
  const shared = Math.min(from.length, to.length);
  while (start < shared && from[start] === to[start]) start += 1;

  let endFrom = from.length;
  let endTo = to.length;
  while (endFrom > start && endTo > start && from[endFrom - 1] === to[endTo - 1]) {
    endFrom -= 1;
    endTo -= 1;
  }

  const deleteFrom = unitOffset(current, start);
  const deleteUnits = unitOffset(current, endFrom) - deleteFrom;
  const insertText = to.slice(start, endTo).join('');

  const run = (): void => {
    if (deleteUnits > 0) ytext.delete(deleteFrom, deleteUnits);
    if (insertText !== '') ytext.insert(deleteFrom, insertText);
  };
  const doc = ytext.doc;
  if (doc !== null) doc.transact(run, origin);
  else run();
}

/**
 * The largest integer font size, between STICKY_FONT_MIN_PX and
 * STICKY_FONT_MAX_PX, that lays the element's text out inside `box` pixels. When
 * even the smallest size is too big, the element is set to the minimum and
 * `overflow` is true: the caller then hides the part that does not fit and shows
 * the fade at the bottom edge.
 *
 * The size is written into the element while measuring, so the element ends up
 * styled with the returned size. Fonts are in world units: the board's own
 * transform scales them with zoom, which is why zoom never needs a re-measure.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const fitsAt = (px: number): boolean => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };

  if (!Number.isFinite(box) || box <= 0) {
    el.style.fontSize = `${STICKY_FONT_MAX_PX}px`;
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }
  if (fitsAt(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  if (!fitsAt(STICKY_FONT_MIN_PX)) {
    el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }

  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX - 1;
  let best = STICKY_FONT_MIN_PX;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (fitsAt(middle)) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  el.style.fontSize = `${best}px`;
  return { fontPx: best, overflow: false };
}
