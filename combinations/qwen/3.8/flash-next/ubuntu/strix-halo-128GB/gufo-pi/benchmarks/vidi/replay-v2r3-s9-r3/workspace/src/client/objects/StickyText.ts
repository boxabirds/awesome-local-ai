/**
 * Sticky note text helpers (story 2): length clamp, minimal Y.Text diff,
 * counter visibility and font auto-fit. Pure logic lives here so it can be
 * unit-tested without a DOM layout engine.
 *
 * Story 9: clampToLimit and applyTextDiff are now shared with text objects
 * via src/shared/text-edit.ts. This file re-exports them with sticky-specific
 * defaults so existing story 2 callers and tests are unchanged.
 */
import type * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '../../shared/config';

/** Padding between a note's edge and its text, in board units. */
export const NOTE_TEXT_INSET = 12;

import { clampToLimit as clampToLimitShared } from '../../shared/text-edit';

/**
 * Keeps at most `max` characters (defaults to STICKY_TEXT_MAX_CHARS).
 * Wraps the shared clampToLimit with a sticky-specific default.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToLimitShared(next, max);
}

/**
 * Writes `next` into `ytext` using the minimal change (common prefix and
 * suffix), so a concurrent typist (story 3) is never overwritten by a full
 * replace. Re-exported from shared/text-edit for backward compatibility.
 */
export { applyTextDiff } from '../../shared/text-edit';

/** True when the remaining budget is small enough to show the counter. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at
 * which the element's content still fits a box of `box` pixels. When even the
 * minimum size does not fit, `overflow` is true (the caller clips and fades the
 * bottom edge). Leaves the element styled with the returned size.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  const fits = (px: number): boolean => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };

  if (!fits(STICKY_FONT_MIN_PX)) return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  if (fits(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };

  let lo = STICKY_FONT_MIN_PX; // fits
  let hi = STICKY_FONT_MAX_PX; // does not fit
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}
