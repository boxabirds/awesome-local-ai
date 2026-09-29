// Sticky note text logic (story 2, sticky.text): length clamp, minimal
// Y.Text diff, counter visibility, and font auto-fit.
//
// The clamp and the Y.Text diff live in src/shared/text-edit.ts (story 9);
// they are re-exported here with the sticky defaults so story 2 callers and
// tests are unchanged.

import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { clampToLimit as clampToLimitAt, applyTextDiff } from '../../shared/text-edit';

export { applyTextDiff };

/** Truncates `next` to at most `max` characters (default STICKY_TEXT_MAX_CHARS). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToLimitAt(next, max);
}

/**
 * The character counter shows when the remaining characters at the limit are
 * at most STICKY_COUNTER_THRESHOLD_CHARS (i.e. 950+ of 1000 chars used).
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
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
