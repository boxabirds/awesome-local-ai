import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS
} from '../../shared/config';
import {
  applyTextDiff,
  clampToLimit as clampToLimitShared
} from '../../shared/text-edit';

export type EndEditNext = 'selected' | 'unselected';

// Story 9 moved the shared implementations to src/shared/text-edit.ts; these
// re-exports keep story 2 callers unchanged with the sticky character limit.
export { applyTextDiff };

export function clampToLimit(next: string, max = STICKY_TEXT_MAX_CHARS): string {
  return clampToLimitShared(next, max);
}

export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

// Largest integer font size in [MIN, MAX] at which the element's content
// still fits vertically inside `box` (board units). Measured at 100% zoom;
// the world transform scales the font uniformly with zoom.
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const fits = (fontPx: number): boolean => {
    el.style.fontSize = `${fontPx}px`;
    return el.scrollHeight <= box;
  };
  if (fits(STICKY_FONT_MAX_PX)) {
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }
  if (!fits(STICKY_FONT_MIN_PX)) {
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { fontPx: lo, overflow: false };
}
