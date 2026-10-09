/**
 * Story 2: sticky note content editing.
 *
 * `clampToLimit` and `applyTextDiff` now live in src/shared/text-edit.ts
 * (story 9) so sticky notes and text objects share them; both are re-exported
 * here unchanged for existing callers.
 */
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { clampToLimit as clampToLimitShared } from '../../shared/text-edit';

export { applyTextDiff } from '../../shared/text-edit';

/** Keeps at most `max` characters. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToLimitShared(next, max);
}

/** Character counter is visible when at most the threshold remains. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at
 * which the element's content fits in `box` px of height; `overflow` when
 * even the minimum does not fit.
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
