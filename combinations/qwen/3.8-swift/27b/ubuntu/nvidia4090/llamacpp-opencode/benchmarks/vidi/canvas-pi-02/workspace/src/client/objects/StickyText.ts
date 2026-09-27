// Sticky note text logic (story 2, sticky.text): length clamp, minimal
// Y.Text diff, counter visibility, and font auto-fit.

import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/** Truncates `next` to at most `max` characters (default STICKY_TEXT_MAX_CHARS). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length > max ? next.slice(0, max) : next;
}

/**
 * The character counter shows when the remaining characters at the limit are
 * at most STICKY_COUNTER_THRESHOLD_CHARS (i.e. 950+ of 1000 chars used).
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/**
 * Applies the minimal change (common prefix + common suffix) from the
 * Y.Text's current value to `next`: at most one delete and/or one insert
 * inside one transaction. A full replace would destroy concurrent typing by
 * others once story 3 ships, so this is required, not optional.
 *
 * Diff boundaries are snapped away from the middle of surrogate pairs so
 * emoji are never split.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  // Common prefix.
  let start = 0;
  const minLen = Math.min(current.length, next.length);
  while (start < minLen && current.charCodeAt(start) === next.charCodeAt(start)) start += 1;
  // Snap the boundary out of a surrogate pair (well-formed text: a low
  // surrogate only follows its high surrogate).
  if (start < current.length && isLowSurrogate(current.charCodeAt(start))) start -= 1;

  // Common suffix (not overlapping the prefix).
  let endCurrent = current.length;
  let endNext = next.length;
  while (endCurrent > start && endNext > start && current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)) {
    endCurrent -= 1;
    endNext -= 1;
  }
  // Snap the suffix start out of a surrogate pair on both sides.
  if (endCurrent < current.length && isLowSurrogate(current.charCodeAt(endCurrent))) endCurrent -= 1;
  if (endNext < next.length && isLowSurrogate(next.charCodeAt(endNext))) endNext -= 1;

  const deleteLength = endCurrent - start;
  const insertText = next.slice(start, endNext);
  if (deleteLength === 0 && insertText.length === 0) return;

  const d = ytext.doc;
  if (d === null) return; // unbound text: nothing to transact against
  d.transact(
    () => {
      if (deleteLength > 0) ytext.delete(start, deleteLength);
      if (insertText.length > 0) ytext.insert(start, insertText);
    },
    origin,
  );
}

/**
 * Finds the largest integer font size in [STICKY_FONT_MIN_PX,
 * STICKY_FONT_MAX_PX] at which the text fits its box (scrollHeight <= box),
 * by binary search, and leaves the element at that size. `overflow` is true
 * when even the minimum size does not fit (the caller shows a bottom fade).
 *
 * `el` must contain the note's text (pre-wrap) with the same padding as the
 * display; the font size is in world px (the board zoom scales uniformly).
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  el.style.fontSize = `${best}px`;
  return { fontPx: best, overflow: el.scrollHeight > box };
}
