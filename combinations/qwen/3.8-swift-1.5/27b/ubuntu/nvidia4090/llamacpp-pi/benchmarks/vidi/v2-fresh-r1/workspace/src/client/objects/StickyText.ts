// Sticky text logic: clamp, diff, counter, font fit.

import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

// Shared text-edit helpers (story 9): single implementation lives in
// src/shared/text-edit.ts; re-exported here for existing importers.
export { clampToLimit, applyTextDiff } from '../../shared/text-edit';

/** Returns true when the character counter should be visible. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Binary-search integer font sizes from STICKY_FONT_MAX_PX down to
 * STICKY_FONT_MIN_PX for the largest size at which scrollHeight <= box.
 * Returns the font size and an overflow flag.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;

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

  // Set to the best size found
  el.style.fontSize = `${best}px`;
  const overflow = el.scrollHeight > box;

  return { fontPx: best, overflow };
}
