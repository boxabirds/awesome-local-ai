// Pure sticky-note text logic: length limit, counter and font fit. The diff and
// clamp helpers live in src/shared/text-edit.ts (shared with text objects).
import { clampEdit as sharedClampEdit, clampToLimit as sharedClampToLimit } from '../../shared/text-edit';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

export { applyTextDiff, diffText, type TextChange } from '../../shared/text-edit';

/** Inner padding of a note in board units (display and editor must match for measurement). */
export const STICKY_PADDING_WORLD = 16;
/** Unitless line height of note text (display and editor must match). */
export const STICKY_LINE_HEIGHT = 1.25;

/** Keeps at most `max` characters (default STICKY_TEXT_MAX_CHARS); see `src/shared/text-edit.ts`. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return sharedClampToLimit(next, max);
}

/** `clampEdit` with the sticky note limit as default; see `src/shared/text-edit.ts`. */
export function clampEdit(prev: string, next: string, max: number = STICKY_TEXT_MAX_CHARS): { text: string; caret: number | null } {
  return sharedClampEdit(prev, next, max);
}

/** The counter shows when STICKY_COUNTER_THRESHOLD_CHARS or fewer characters remain. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at which
 * `el`'s content height fits in `box`. Leaves `el` at that size. `overflow` is true
 * when the text does not fit even at the minimum size.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const fits = (px: number) => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };
  let result: { fontPx: number; overflow: boolean };
  if (fits(STICKY_FONT_MAX_PX)) {
    result = { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  } else if (!fits(STICKY_FONT_MIN_PX)) {
    result = { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  } else {
    // Invariant: fits(lo), !fits(hi).
    let lo = STICKY_FONT_MIN_PX;
    let hi = STICKY_FONT_MAX_PX;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    result = { fontPx: lo, overflow: false };
  }
  el.style.fontSize = `${result.fontPx}px`;
  return result;
}
