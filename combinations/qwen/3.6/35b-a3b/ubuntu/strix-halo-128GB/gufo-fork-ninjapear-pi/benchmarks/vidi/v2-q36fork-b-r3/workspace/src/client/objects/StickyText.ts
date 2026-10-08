// Re-export shared text-edit helpers for backward compatibility
export {
  clampToLimit,
  applyTextDiff,
} from '@shared/text-edit';

import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX } from '@shared/config';

/**
 * Compute whether the counter should be visible.
 * Shows when remaining characters ≤ threshold, i.e., current length ≥ (max - threshold).
 */
export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length;
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Binary-search the largest font size in [minPx, maxPx] where scrollHeight fits
 * within `box` px. Returns the pixel size and an overflow flag.
 * Runs on text change and mount only (zoom scales uniformly).
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let bestFit = lo;

  while (lo <= hi) {
    const mid = Math.round((lo + hi) / 2);
    el.style.fontSize = `${mid}px`;
    const fits = el.scrollHeight <= box;
    if (fits) {
      bestFit = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  el.style.fontSize = `${bestFit}px`;

  // Check overflow at bestFit
  const overflow = el.scrollHeight > box;

  return { fontPx: bestFit, overflow };
}
