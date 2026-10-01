import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { clampToLimit as clampText } from '../../shared/text-edit';

export { applyTextDiff, mapCaretThroughDelta } from '../../shared/text-edit';
export type { TextDelta } from '../../shared/text-edit';

export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampText(next, max);
}

export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/** Largest integer font size in [min, max] whose content height fits in `box`. Sets `el.style.fontSize`. */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  const fits = (px: number) => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  const overflow = !fits(lo);
  return { fontPx: lo, overflow };
}
