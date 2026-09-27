import type { Text as YText } from 'yjs';

import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/**
 * Pure text helpers for sticky notes (design "sticky.text"): the length clamp,
 * the minimal Y.Text diff (required so a concurrent editor's characters are not
 * destroyed once story 3 lands), the counter visibility rule and the
 * measurement-driven font fit.
 *
 * The diff and clamp are DOM-free; `fitFontSize` reads layout from an element
 * the caller measures, and is only meaningful in a real browser (jsdom reports a
 * zero `scrollHeight`), so it is verified end to end.
 */

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Keep at most `max` characters. Characters beyond the limit are dropped. A cut
 * that would land between the two code units of a surrogate pair backs off by
 * one, so the note never holds a lone (invalid) surrogate.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  let cut = max;
  // The character just before the cut is a high (leading) surrogate whose low
  // half is the first dropped character: drop the whole pair instead of splitting.
  if (isHighSurrogate(next.charCodeAt(cut - 1))) cut -= 1;
  return next.slice(0, cut);
}

/**
 * Write `next` into `ytext` with the smallest possible change: a common prefix
 * and common suffix are kept, and only the differing middle is replaced with a
 * single delete and/or a single insert, inside one transaction. Surrogate pairs
 * are never split by the prefix/suffix scan.
 */
export function applyTextDiff(ytext: YText, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  const doc = ytext.doc;
  if (doc === null) return; // detached text cannot be written

  const curLen = current.length;
  const nextLen = next.length;

  let start = 0;
  while (
    start < curLen &&
    start < nextLen &&
    current.charCodeAt(start) === next.charCodeAt(start)
  ) {
    start += 1;
  }
  // Never break a surrogate pair that is equal up to its high half.
  if (start > 0 && isHighSurrogate(current.charCodeAt(start - 1))) start -= 1;

  let endCur = curLen;
  let endNext = nextLen;
  while (
    endCur > start &&
    endNext > start &&
    current.charCodeAt(endCur - 1) === next.charCodeAt(endNext - 1)
  ) {
    endCur -= 1;
    endNext -= 1;
  }
  if (endCur > start && endCur < curLen && isLowSurrogate(current.charCodeAt(endCur))) {
    endCur -= 1;
    endNext -= 1;
  }

  const deleteLength = endCur - start;
  const inserted = next.slice(start, endNext);

  doc.transact(() => {
    if (deleteLength > 0) ytext.delete(start, deleteLength);
    if (inserted.length > 0) ytext.insert(start, inserted);
  }, origin);
}

/** The counter shows when this many characters (or fewer) remain before the limit. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size in `[STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]` for
 * which the element's content still fits within `box` (its fixed height in px),
 * measured by `scrollHeight`. Leaves the element set to the chosen size.
 *
 * When even the minimum size overflows, returns the minimum and `overflow: true`
 * so the caller can hide the overflow and draw the bottom fade.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const fits = (px: number): boolean => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };

  if (fits(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  if (!fits(STICKY_FONT_MIN_PX)) {
    el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }

  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}
