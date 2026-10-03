/**
 * Sticky note text utilities: clamp, diff, counter visibility, font fit.
 */

import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX } from '../../shared/config';
import { clampToLimit as sharedClampToLimit, applyTextDiff } from '../../shared/text-edit';

// Story 9: clamp/diff moved to src/shared/text-edit.ts so both object types
// share them. Re-exported here (with the sticky default) so story 2 callers
// and tests are unchanged.
export { applyTextDiff };

/**
 * Clamp a string to at most `max` characters (default: sticky limit).
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return sharedClampToLimit(next, max);
}

/**
 * Returns true when the character counter should be visible
 * (remaining characters <= STICKY_COUNTER_THRESHOLD_CHARS).
 */
export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length;
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Binary-search the largest font size (integer px) in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * at which the element's scrollHeight fits within `box`.
 * Returns the font size and an overflow flag.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;

  // Binary search for the largest size that fits
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  el.style.fontSize = `${best}px`;
  const overflow = el.scrollHeight > box;

  return { fontPx: best, overflow };
}
