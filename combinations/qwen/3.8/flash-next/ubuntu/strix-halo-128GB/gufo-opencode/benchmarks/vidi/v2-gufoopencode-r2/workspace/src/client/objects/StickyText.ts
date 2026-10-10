// Pure sticky-note text logic: length clamp, minimal Y.Text diff, counter
// visibility and font auto-fit by measurement. The clamp and diff primitives
// moved to shared/text-edit.ts for story 9; the exports are re-wired here so
// existing import sites are unchanged.

import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { clampToLimit as clampGeneric } from '../../shared/text-edit';

export { applyTextDiff } from '../../shared/text-edit';

// Inner text box of a note in board units: the note is STICKY_SIZE_WORLD with
// STICKY_PADDING_WORLD of padding on every side (see styles.css).
export const STICKY_PADDING_WORLD = 16;
export const STICKY_TEXT_BOX_WORLD = STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2;

export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampGeneric(next, max);
}

export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

// Largest integer size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] (board
// units; zoom scales the note uniformly) at which the element's content still
// fits inside `box` px. When even the minimum overflows, `overflow` is true
// and the caller clips and fades instead.
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  const fits = (px: number): boolean => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };
  if (fits(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  if (!fits(STICKY_FONT_MIN_PX)) return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return { fontPx: lo, overflow: false };
}
