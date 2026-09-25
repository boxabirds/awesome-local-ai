// Pure text logic for sticky notes: the length limit, the counter rule and font fitting. The shared editing helpers
// live in src/shared/text-edit.ts (story 9); they are re-exported here with the note limit as default.
import {
  applyTextDiff,
  clampToLimit as clampText,
  limitEdit as limitTextEdit,
  transformIndex,
} from '../../shared/text-edit';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

export { applyTextDiff, transformIndex };

/** `next` cut to at most `max` characters (UTF-16 code units), without splitting an emoji. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampText(next, max);
}

/** Story 2's limit rule (see `limitEdit` in text-edit.ts) with the note limit as default. */
export function limitEdit(prev: string, next: string, max: number = STICKY_TEXT_MAX_CHARS) {
  return limitTextEdit(prev, next, max);
}

/** The counter shows once the remaining characters drop to STICKY_COUNTER_THRESHOLD_CHARS. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at which `el`'s content fits
 * in `box` px of height (`scrollHeight <= box`). Leaves `el` at that size. `overflow` is true when even
 * the minimum size does not fit.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const fits = (px: number) => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };
  if (fits(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  if (!fits(STICKY_FONT_MIN_PX)) return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  let lo = STICKY_FONT_MIN_PX; // fits
  let hi = STICKY_FONT_MAX_PX; // does not fit
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}

