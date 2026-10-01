import {
  STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

import { applyTextDiff, clampToLimit as clampShared } from '../../shared/text-edit';

export { applyTextDiff };

export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampShared(next, max);
}

export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/** Largest integer font size in [MIN, MAX] at which el's content fits within `box` px of height. */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const fits = (px: number) => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  if (fits(hi)) return { fontPx: hi, overflow: false };
  if (!fits(lo)) return { fontPx: lo, overflow: true };
  while (hi - lo > 1) { // invariant: lo fits, hi does not
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) lo = mid; else hi = mid;
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}
