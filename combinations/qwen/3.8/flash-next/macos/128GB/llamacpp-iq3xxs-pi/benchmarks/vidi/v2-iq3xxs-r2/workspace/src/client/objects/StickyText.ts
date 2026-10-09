import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { clampToLimit as clampToCharLimit } from '../../shared/text-edit';

/**
 * Pure text logic behind a sticky note's editor. The character limit and the shared-type
 * writes are the ones story 9 also needs for text objects, so they live in
 * `src/shared/text-edit.ts`; what is left here is the sticky note's own counter and font
 * auto-fit, plus these re-exports with `STICKY_TEXT_MAX_CHARS` bound in — which is what
 * story 2's callers and tests import.
 */

/** The shared primitives, with a sticky note's limit as the default. */
export {
  applyLocalEdit,
  applyTextDiff,
  minimalEdit,
  remoteShift,
  type TextDeltaOp,
} from '../../shared/text-edit';

/**
 * Keep at most `max` characters. Typing or pasting never grows a note past 1,000: the
 * characters beyond the 1,000th are simply dropped.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToCharLimit(next, max);
}

/** True when the remaining characters are few enough that the counter should show. */
export function counterVisible(length: number): boolean {
  if (!Number.isFinite(length)) return false;
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at which the
 * element's content still fits in `box` (board units, measured with `scrollHeight`,
 * which is unaffected by the world layer's zoom transform). The size is left applied to
 * the element. `overflow` is true when even the smallest size does not fit, in which
 * case the caller clips the content and fades the bottom edge.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  if (!Number.isFinite(box) || box <= 0) {
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }
  const fitsAt = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };
  if (!fitsAt(STICKY_FONT_MIN_PX)) {
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }
  if (fitsAt(STICKY_FONT_MAX_PX)) {
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }
  // Largest size that still fits: binary search over the integers in range.
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fitsAt(mid)) lo = mid;
    else hi = mid;
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}
