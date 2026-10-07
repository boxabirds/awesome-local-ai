/**
 * Sticky note text logic (design anchor `sticky.text`), split from the React
 * component so the rules that decide what ends up in the shared document are
 * testable on their own:
 *
 * - `clampToLimit`   — the 1,000 character limit (sticky.text_limit), re-exported
 *                    from `src/shared/text-edit.ts`, where story 9 put it so free
 *                    text can share the rule
 * - `applyTextDiff`  — the minimal change into the shared `Y.Text`, same story
 * - `counterVisible` — when the "n/1000" counter appears
 * - `fitFontSize`    — the auto-fit search (sticky.text_fit)
 *
 * No DOM access beyond the one element `fitFontSize` measures, and no React.
 */

import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config.js';

export { applyTextDiff, clampToLimit } from '../../shared/text-edit.js';

/** The character count the counter starts warning about. */
export const COUNTER_REMAINING_THRESHOLD = STICKY_COUNTER_THRESHOLD_CHARS;

/**
 * Does a note of `length` characters have at most
 * `STICKY_COUNTER_THRESHOLD_CHARS` characters left? The counter appears only
 * near the limit ("within 50 characters of the 1,000 character limit").
 */
export function counterVisible(length: number): boolean {
  if (!Number.isFinite(length)) return false;
  return STICKY_TEXT_MAX_CHARS - Math.max(0, length) <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/** Style properties that must match between the measured element and the text. */
const FONT_STEP_PX = 1;

/**
 * The largest integer font size, in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX],
 * at which the element's content fits in `box` pixels of height (measured with
 * `scrollHeight`, so it works for a wrapped block and for a textarea).
 *
 * When even the smallest size does not fit, `overflow` is true: the text keeps
 * the smallest size and the note hides the overflow behind a fade, so nothing
 * is drawn outside the note (sticky.text_fit).
 *
 * The font size is in board units: the note is inside the scaled world layer,
 * so it grows and shrinks with the board zoom and the fit never has to be
 * recomputed for a zoom change.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  const available = Number.isFinite(box) && box > 0 ? box : 0;
  const fitsAt = (fontPx: number): boolean => {
    el.style.fontSize = `${fontPx}px`;
    return el.scrollHeight <= available;
  };

  if (fitsAt(STICKY_FONT_MAX_PX)) {
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }
  if (!fitsAt(STICKY_FONT_MIN_PX)) {
    // Text does not fit at the readable minimum: keep the minimum and report
    // the overflow so the note can fade its bottom edge.
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }

  // The smallest size fits and the largest does not: binary search the largest
  // size that still fits. The range is 15 integers, so at most 4 measurements.
  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  while (high - low > FONT_STEP_PX) {
    const middle = Math.floor((low + high) / 2);
    if (fitsAt(middle)) low = middle;
    else high = middle - 1;
  }
  const fontPx = fitsAt(high) ? high : low;
  return { fontPx, overflow: false };
}
