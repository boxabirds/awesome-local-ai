/**
 * Pure text logic for sticky notes: the length limit, the minimal diff into a
 * shared `Y.Text`, the character counter and the auto-fit font size.
 *
 * Deliberately free of React and of any DOM assumptions beyond measuring one
 * element, so the rules are unit-testable and reusable.
 */

import * as Y from 'yjs';

import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/** True for UTF-16 high surrogates (the first unit of an emoji pair). */
const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
/** True for UTF-16 low surrogates (the second unit of an emoji pair). */
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/**
 * Keeps at most `max` characters (default `STICKY_TEXT_MAX_CHARS`): typing or
 * pasting that would exceed the limit adds nothing beyond the last allowed
 * character.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (typeof next !== 'string') return '';
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 0;
  if (next.length <= limit) return next;
  const cut = next.slice(0, limit);
  // Never leave half of a surrogate pair behind.
  const last = cut.length > 0 ? cut.charCodeAt(cut.length - 1) : 0;
  if (limit > 0 && isHighSurrogate(last)) return cut.slice(0, -1);
  return cut;
}

/**
 * Writes `next` into `ytext` with the smallest possible change: a common prefix
 * and suffix are kept, everything between them is one delete and/or one insert
 * inside a single transaction. The minimal diff is what lets two people type in
 * the same note without destroying each other's characters (story 3).
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  const oldLength = current.length;
  const newLength = next.length;

  let start = 0;
  while (start < oldLength && start < newLength && current[start] === next[start]) start += 1;
  let endOld = oldLength;
  let endNew = newLength;
  while (endOld > start && endNew > start && current[endOld - 1] === next[endNew - 1]) {
    endOld -= 1;
    endNew -= 1;
  }
  // Pull the boundaries out of any surrogate pair they landed in.
  if (
    start > 0 &&
    start < oldLength &&
    isHighSurrogate(current.charCodeAt(start - 1)) &&
    isLowSurrogate(current.charCodeAt(start))
  ) {
    start -= 1;
  }
  if (
    endOld > start &&
    endOld < oldLength &&
    isLowSurrogate(current.charCodeAt(endOld)) &&
    isHighSurrogate(current.charCodeAt(endOld - 1))
  ) {
    endOld -= 1;
    endNew -= 1;
  }

  const removed = endOld - start;
  const added = next.slice(start, endNew);
  const apply = () => {
    if (removed > 0) ytext.delete(start, removed);
    if (added.length > 0) ytext.insert(start, added);
  };
  const doc = ytext.doc;
  if (doc) doc.transact(apply, origin);
  else apply();
}

/**
 * True when the character counter should be shown, i.e. when
 * `STICKY_COUNTER_THRESHOLD_CHARS` or fewer characters remain.
 */
export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - (Number.isFinite(length) ? length : 0);
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size, in `[STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]`, at
 * which the element's content fits in `box` pixels (`scrollHeight <= box`),
 * found by binary search. When even the smallest size does not fit, `overflow`
 * is true: the caller keeps the font at the minimum, clips the text inside the
 * note and shows a fade at the bottom edge.
 *
 * The element's `font-size` style is left at the returned size.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  // Each probe forces a layout, so the search does at most log2(range) of them.
  const fits = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };

  if (!Number.isFinite(box) || box <= 0) {
    // No layout information (e.g. jsdom): keep the largest size.
    el.style.fontSize = `${STICKY_FONT_MAX_PX}px`;
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }
  if (fits(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  if (!fits(STICKY_FONT_MIN_PX)) {
    el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }
  // The minimum fits and the maximum does not: binary-search between them.
  let lo = STICKY_FONT_MIN_PX; // fits
  let hi = STICKY_FONT_MAX_PX; // does not fit
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}
