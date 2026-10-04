import {
  clampToLimit as clampToCharLimit,
} from '../../shared/text-edit';

import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/**
 * Pure text helpers for sticky notes: length clamping, minimal Y.Text diffing,
 * the counter visibility rule and font auto-fit. Kept free of React so the diff
 * and clamp logic is unit-testable against a real Y.Text.
 *
 * Story 9 moved the two editing primitives to `shared/text-edit.ts`, where a
 * text object can use them too; they are re-exported here with the sticky note's
 * own character limit so story 2's callers and tests are unchanged.
 */

export { applyTextDiff } from '../../shared/text-edit';

/** Keep at most `max` characters (default STICKY_TEXT_MAX_CHARS). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToCharLimit(next, max);
}

/**
 * True when the remaining character budget is within
 * STICKY_COUNTER_THRESHOLD_CHARS (i.e. the counter should be shown).
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

export interface FontFit {
  fontPx: number;
  overflow: boolean;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at
 * which the element's content fits within `box` (its content box, px). Applied
 * to `el.style.fontSize`. When it does not fit even at the minimum, `overflow`
 * is true (the caller clips and fades). Monotonic in size, so a binary search
 * finds the largest that fits.
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;
  let anyFits = false;

  while (low <= high) {
    const mid = (low + high) >> 1;
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      best = mid;
      anyFits = true;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  el.style.fontSize = `${best}px`;
  return { fontPx: best, overflow: !anyFits || el.scrollHeight > box };
}
