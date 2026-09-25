/**
 * Sticky note text helpers (story 2).
 *
 * Pure logic shared by the text editor component and its unit tests: the
 * length limit, the minimal Y.Text diff and the font auto-fit. Nothing here
 * touches React, so the diff can be tested against a real `Y.Text`.
 */
import type * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/** True for half of a surrogate pair, which must never be split apart. */
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Cut `next` at the note's character limit (the paste case in the PRD). When
 * the cut would land between the two code units of a surrogate pair the pair
 * is kept by cutting one unit earlier instead.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  let cut = max;
  if (isLowSurrogate(next.charCodeAt(cut))) cut -= 1;
  return cut <= 0 ? '' : next.slice(0, cut);
}

/** Split a string into code points so a surrogate pair counts as one unit. */
function codePoints(value: string): string[] {
  return Array.from(value);
}

/**
 * Write `next` into `ytext` with the smallest change that produces it: a
 * common prefix and a common suffix are kept, everything between them is
 * replaced by one delete and/or one insert inside a single transaction.
 *
 * A full replace would destroy text another person typed while I was typing
 * (story 3), which is why the diff, not just the result, is specified.
 * Boundaries are computed in code points so a surrogate pair is never split.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  if (!ytext.doc) return;
  const before = ytext.toString();
  if (before === next) return;

  const oldChars = codePoints(before);
  const newChars = codePoints(next);

  let start = 0;
  const shared = Math.min(oldChars.length, newChars.length);
  while (start < shared && oldChars[start] === newChars[start]) start += 1;

  let oldEnd = oldChars.length;
  let newEnd = newChars.length;
  while (oldEnd > start && newEnd > start && oldChars[oldEnd - 1] === newChars[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  const removed = oldChars.slice(start, oldEnd).join('');
  const added = newChars.slice(start, newEnd).join('');
  if (removed.length === 0 && added.length === 0) return;

  // Y.Text indexes by UTF-16 code unit, hence `.length` of the prefix.
  const index = oldChars.slice(0, start).join('').length;

  ytext.doc.transact(() => {
    if (removed.length > 0) ytext.delete(index, removed.length);
    if (added.length > 0) ytext.insert(index, added);
  }, origin);
}

/**
 * True when the character counter should be shown: only once the note is
 * within STICKY_COUNTER_THRESHOLD_CHARS of the limit.
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Find the largest integer font size in
 * [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at which the element's content
 * still fits into `box` pixels of height. The element is measured with
 * `scrollHeight`, so it must be the element that holds the text (display div
 * or textarea) and `box` must be its own inner height.
 *
 * `overflow` is true when even the smallest size does not fit: the caller then
 * shows the fade over the clipped text. Font sizes are in world units, so this
 * only has to run when the text changes, not when the zoom changes.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  const fits = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };

  if (!fits(STICKY_FONT_MIN_PX)) {
    el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }

  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  el.style.fontSize = `${low}px`;
  return { fontPx: low, overflow: false };
}