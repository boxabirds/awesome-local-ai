/**
 * Sticky note text utilities: clamp, minimal Y.Text diff, counter visibility, font fit.
 *
 * `clampToLimit` and `applyTextDiff` are re-exported from `shared/text-edit.ts`
 * with STICKY_TEXT_MAX_CHARS so story 2 callers and tests are unchanged.
 */
import { STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS } from '../../shared/config';
import { clampToLimit as _clampToLimit, applyTextDiff as _applyTextDiff } from '../../shared/text-edit';

export const clampToLimit: (next: string, max?: number) => string =
  (next, max = STICKY_TEXT_MAX_CHARS) => _clampToLimit(next, max);
export const applyTextDiff = _applyTextDiff;

/** Whether to show the character counter for a note of given length. */
export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length;
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Binary search for the largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * such that the element's scrollHeight fits within `box` pixels.
 * Returns the chosen size and whether overflow persists even at minimum size.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;

  // Try max size first
  el.style.fontSize = `${STICKY_FONT_MAX_PX}px`;
  if (el.scrollHeight <= box) {
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }

  // Try min size
  el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
  if (el.scrollHeight > box) {
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }

  // Binary search between lo and hi
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      best = mid;
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return { fontPx: best, overflow: false };
}
