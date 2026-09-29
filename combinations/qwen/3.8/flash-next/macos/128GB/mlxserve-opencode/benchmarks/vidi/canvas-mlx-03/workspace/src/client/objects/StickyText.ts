// Pure text helpers for sticky notes: the character-counter visibility rule and
// font auto-fit by measurement, plus the shared clamp/diff re-exported so story
// 2's callers and tests are unchanged. The shared primitives live in
// `src/shared/text-edit.ts` (story 9), where both text objects and sticky notes
// reach the same maths.

import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '../../shared/config.ts';

export { applyTextDiff } from '../../shared/text-edit.ts';
import { clampToLimit as clampShared } from '../../shared/text-edit.ts';

/** Story 2's signature: the sticky-note length limit is the default. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampShared(next, max);
}

/** The counter shows when the remaining characters drop to the threshold. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] whose
 * measured `scrollHeight` fits in `box` (inner note content height). Mutates
 * `el.style.fontSize` to the chosen size. When even the minimum does not fit,
 * returns the minimum with `overflow: true` so the caller can show the fade.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  el.style.fontSize = `${STICKY_FONT_MAX_PX}px`;
  if (el.scrollHeight <= box) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };

  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;
  let fits = false;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      best = mid;
      fits = true;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (fits) return { fontPx: best, overflow: false };
  el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
  return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
}
