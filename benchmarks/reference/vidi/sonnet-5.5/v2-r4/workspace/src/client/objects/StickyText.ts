import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit as sharedClamp } from '../../shared/text-edit';

/** Story 2 callers keep the sticky limit as the default; the shared implementation lives in text-edit.ts. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return sharedClamp(next, max);
}
export { applyTextDiff };

export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Finds the largest integer font size in [MIN, MAX] at which the element's content height fits `box`.
 * `el` must size to its content (so scrollHeight is the natural text height).
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const fits = (px: number) => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  if (fits(hi)) return { fontPx: hi, overflow: false }; // most notes are short: one measurement
  if (!fits(lo)) return { fontPx: lo, overflow: true };
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}
