// Sticky note text logic (story 2, sticky.text contract).
// Pure text logic (counter, font fitting) plus re-exports of the shared
// clamp/diff helpers.
//
// Story 9 (text.editing.shared): clampToLimit and applyTextDiff moved to
// src/shared/text-edit.ts so free text reuses them; they are re-exported
// here (with the sticky default limit) so story 2 callers are unchanged.

import {
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '../../shared/config';
import { clampToLimit as sharedClampToLimit, applyTextDiff } from '../../shared/text-edit';

export { applyTextDiff };

/** Padding between the note edge and its text (world units). */
export const NOTE_PADDING_PX = 12;
/** Height (world units) of the region note text must fit into. */
export const NOTE_TEXT_BOX = STICKY_SIZE_WORLD - NOTE_PADDING_PX * 2;

/** Keep at most `max` characters (default STICKY_TEXT_MAX_CHARS); characters
 *  beyond the limit are dropped. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return sharedClampToLimit(next, max);
}

/**
 * The counter is shown when at most STICKY_COUNTER_THRESHOLD_CHARS characters
 * remain until the limit.
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Find the largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * (board units at 100% zoom — it scales with the camera zoom) at which the
 * element's content fits within `box` pixels. If even the minimum does not
 * fit, returns the minimum with `overflow: true` (the caller clips and shows
 * a fade at the bottom edge).
 *
 * `el` must be laid out (real browser); jsdom has no layout, so this is only
 * verified in e2e.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  const fits = (px: number): boolean => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best === -1) {
    el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }
  return { fontPx: best, overflow: false };
}
