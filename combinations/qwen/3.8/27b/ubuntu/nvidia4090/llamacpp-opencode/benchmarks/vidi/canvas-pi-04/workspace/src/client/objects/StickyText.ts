// Story 2: sticky note text editing helpers (anchor: sticky.text).
//
// Pure logic, no DOM except `fitFontSize` (which measures a live element).
// Story 3 depends on `applyTextDiff` being a *minimal* diff: a full replace
// would destroy concurrent typing by others once the doc is shared live.

import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { clampToLimit as clampToLimitShared } from '../../shared/text-edit';

/** Keep at most `max` characters; longer input is truncated (no wrap). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToLimitShared(next, max);
}

// Story 9: the minimal diff now lives in the shared module; re-export so story 2's
// callers and tests are unchanged.
export { applyTextDiff } from '../../shared/text-edit';

/** The character counter shows when the remaining capacity is at or below the threshold. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at
 * which `el`'s content fits within `box` CSS px of height (binary search,
 * measuring `scrollHeight`). Sets the element's font size to the result and
 * reports whether the content still overflows at the smallest size.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
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
