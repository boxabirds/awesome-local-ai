import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff as applyTextDiffGeneric, clampToLimit as clampToLimitGeneric } from '../../shared/text-edit';
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_TEXT_MAX_CHARS } from '../../shared/config';

export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToLimitGeneric(next, max);
}

export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown = LOCAL_ORIGIN): void {
  applyTextDiffGeneric(ytext, next, origin);
}

export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

export interface FitResult {
  fontPx: number;
  overflow: boolean;
}

// Binary-searches the largest integer font size (within [MIN, MAX]) at which the
// element's content height fits within `box`. When even the minimum size does
// not fit, `overflow` is true and the caller must clip and show a fade.
export function fitFontSize(el: HTMLElement, box: number): FitResult {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;
  let fits = false;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      best = mid;
      fits = true;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  el.style.fontSize = `${best}px`;
  return { fontPx: best, overflow: !fits };
}
