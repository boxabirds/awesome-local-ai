import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX } from '@shared/config';
import { clampToLimit as clampToLimitAt, applyTextDiff } from '@shared/text-edit';

// Story 9: the shared helpers live in src/shared/text-edit.ts so free text
// and stickies share them. Re-exported here with the sticky default so
// story 2 callers and tests are unchanged.
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToLimitAt(next, max);
}
export { applyTextDiff };

export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;

  // Binary search for the largest font size where scrollHeight <= box
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
