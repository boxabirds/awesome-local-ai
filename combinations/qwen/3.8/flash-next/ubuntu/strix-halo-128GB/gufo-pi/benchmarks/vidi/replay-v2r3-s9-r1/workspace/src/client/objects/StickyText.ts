/**
 * Sticky note text helpers (story 2): length clamp, minimal Y.Text diff,
 * counter visibility and font auto-fit. Pure logic lives here so it can be
 * unit-tested without a DOM layout engine.
 */
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '../../shared/config';
import { clampToLimit as clampToLimitShared } from '../../shared/text-edit';

// The length clamp and the minimal `Y.Text` diff live in `shared/text-edit.ts`
// so sticky notes and free text (story 9) share one implementation. They are
// re-exported here with the sticky defaults so story 2 callers are unchanged.
export { applyTextDiff } from '../../shared/text-edit';

/** Padding between a note's edge and its text, in board units. */
export const NOTE_TEXT_INSET = 12;

/** Keeps at most `STICKY_TEXT_MAX_CHARS` characters (see `shared/text-edit.ts`). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToLimitShared(next, max);
}

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
