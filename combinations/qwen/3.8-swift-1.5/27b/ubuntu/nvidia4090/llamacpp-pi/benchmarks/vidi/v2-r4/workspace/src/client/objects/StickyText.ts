import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX } from '../../shared/config';
import { clampToLimit as clampToLimitWithMax } from '../../shared/text-edit';

export { applyTextDiff } from '../../shared/text-edit';

/**
 * Story 2 sticky-text clamp: defaults to STICKY_TEXT_MAX_CHARS so existing
 * callers are unchanged (story 9 moved the implementation to the shared
 * text-edit module).
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToLimitWithMax(next, max);
}

export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Binary-searches for the largest font size (integer px) in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * at which the text fits within `box` pixels of height.
 * Returns the font size and whether there is overflow (text doesn't fit even at min size).
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  el.style.fontSize = `${best}px`;
  const overflow = el.scrollHeight > box;
  return { fontPx: best, overflow };
}
