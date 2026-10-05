import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MIN_PX,
  STICKY_FONT_MAX_PX,
} from '../../shared/config';
import { clampToLimit as clampToLimitShared } from '../../shared/text-edit';

// Story 9: the shared helpers moved to src/shared/text-edit.ts so free text
// (objects/text.ts) can use them too. Re-exported here with the sticky
// defaults so story 2 callers and tests are unchanged.
export { applyTextDiff } from '../../shared/text-edit';

/** Padding inside a note around the text (board units). */
export const STICKY_TEXT_PADDING = 16;

/** Keeps at most `max` characters (default STICKY_TEXT_MAX_CHARS). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToLimitShared(next, max);
}

/** True when `STICKY_COUNTER_THRESHOLD_CHARS` or fewer characters remain. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Binary-searches the largest integer font size in [STICKY_FONT_MIN_PX,
 * STICKY_FONT_MAX_PX] at which the element's content fits `box`
 * (scrollHeight <= box). The font is in board units, so it scales with zoom.
 * Leaves the element at the chosen size and reports `overflow` when the
 * content does not fit even at the minimum size.
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

  el.style.fontSize = `${best}px`;
  return { fontPx: best, overflow: el.scrollHeight > box };
}
