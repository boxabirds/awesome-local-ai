/**
 * Sticky note text helpers (story 2).
 *
 * Pure logic shared by the text editor component and its unit tests: the
 * length limit, the minimal Y.Text diff and the font auto-fit. Nothing here
 * touches React, so the diff can be tested against a real `Y.Text`.
 *
 * Story 9: clampToLimit and applyTextDiff moved to `src/shared/text-edit.ts`
 * so both sticky notes and text objects can share them. This file re-exports
 * them with the sticky-note defaults so all callers are unchanged.
 */
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { clampToLimit as _clampToLimit, applyTextDiff as _applyTextDiff } from '../../shared/text-edit';

/** Re-export with the sticky-note default limit. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return _clampToLimit(next, max);
}

/** Re-export the shared diff unchanged. */
export const applyTextDiff = _applyTextDiff;

/**
 * True when the character counter should be shown: only once the note is
 * within STICKY_COUNTER_THRESHOLD_CHARS of the limit.
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Find the largest integer font size in
 * [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at which the element's content
 * still fits into `box` pixels of height. The element is measured with
 * `scrollHeight`, so it must be the element that holds the text (display div
 * or textarea) and `box` must be its own inner height.
 *
 * `overflow` is true when even the smallest size does not fit: the caller then
 * shows the fade over the clipped text. Font sizes are in world units, so this
 * only has to run when the text changes, not when the zoom changes.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  const fits = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };

  if (!fits(STICKY_FONT_MIN_PX)) {
    el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }

  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  el.style.fontSize = `${low}px`;
  return { fontPx: low, overflow: false };
}