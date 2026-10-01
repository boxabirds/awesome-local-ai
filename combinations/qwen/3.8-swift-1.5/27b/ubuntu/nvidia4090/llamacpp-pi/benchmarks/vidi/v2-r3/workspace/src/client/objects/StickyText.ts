import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MIN_PX,
  STICKY_FONT_MAX_PX,
} from '../../shared/config';
import { clampToLimit as clampToMax } from '../../shared/text-edit';

/**
 * Keep at most `max` characters (default STICKY_TEXT_MAX_CHARS). Characters
 * beyond the limit are dropped. (Story 9: the shared implementation lives in
 * src/shared/text-edit.ts; this wrapper keeps story 2's default limit.)
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToMax(next, max);
}

/** Story 9: shared with the text objects (re-export). */
export { applyTextDiff } from '../../shared/text-edit';

/**
 * True when the note has `STICKY_COUNTER_THRESHOLD_CHARS` or fewer characters
 * remaining before the limit (i.e. the counter should be shown).
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Binary-search the largest integer font size in [STICKY_FONT_MIN_PX,
 * STICKY_FONT_MAX_PX] (board units, so it scales with zoom) at which `el`'s
 * scrollHeight fits within `box`. If the text does not fit even at the minimum
 * size, `overflow` is true (the caller clips and shows a bottom fade).
 *
 * `el` must already contain the note's text; the function temporarily sets the
 * font size while measuring and restores the final size.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;

  const fits = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };

  // Find the largest size that fits.
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  el.style.fontSize = `${best}px`;
  const overflow = best === STICKY_FONT_MIN_PX && el.scrollHeight > box;
  return { fontPx: best, overflow };
}
