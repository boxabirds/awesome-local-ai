/**
 * Sticky note text logic: the length limit, the character counter rule and the
 * font auto-fit. Pure apart from the one DOM element `fitFontSize` measures
 * (real layout is only needed there, which is why the fit itself is verified in
 * e2e).
 *
 * Story 9 moved the two pieces that are not about notes — `clampToLimit` and
 * `applyTextDiff` — into `shared/text-edit.ts`, and this module re-exports them
 * with the note's own character limit as the default, so story 2's callers and
 * tests are unchanged.
 */

import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { clampToLimit as clampToLimitChars } from '../../shared/text-edit';

/**
 * Keep at most `max` characters (sticky.text_limit) — `shared/text-edit`'s rule
 * with a note's own limit assumed.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToLimitChars(next, max);
}

export { applyTextDiff } from '../../shared/text-edit';

/**
 * True when the character counter should show: remaining characters
 * <= STICKY_COUNTER_THRESHOLD_CHARS (so at 950 of 1,000 it appears). This is a
 * note's rule, not the board's — story 9's text objects have a limit and no counter
 * — and it is handed to the shared editor as the rule it is.
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Binary-search integer font sizes in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * (at 100% zoom; the size is in board units so it scales with zoom) for the
 * largest at which the element's text fits `box` pixels, and apply it to
 * `el`. When even the minimum does not fit, `overflow` is true: the caller
 * hides the overflow and fades the bottom edge (sticky.text_fit).
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const fits = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };

  if (fits(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };

  if (!fits(STICKY_FONT_MIN_PX)) {
    el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }

  // `lo` fits, `hi` does not; converge on the largest fitting size.
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}
