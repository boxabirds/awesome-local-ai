/**
 * The text logic of a sticky note: the auto-fit measurement, and the shared
 * text rules re-exported with the note's own limit.
 *
 * `clampToLimit`, `shiftCaret` and `applyTextDiff` moved to
 * `src/shared/text-edit.ts` in story 9, because a text object needs the same
 * minimal-diff and character-limit rules and two copies of them would drift
 * apart. They come back out of here with `STICKY_TEXT_MAX_CHARS` defaulted in,
 * so every caller and every test from story 2 reads and behaves exactly as it
 * did before the move.
 *
 * No React and no layout here except `fitFontSize`, which measures an element.
 */
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import {
  applyTextDiff as applyTextDiffShared,
  clampToLimit as clampToLimitShared,
  shiftCaret,
} from '../../shared/text-edit';

export { applyTextDiffShared as applyTextDiff, shiftCaret };

/** Keep at most `max` characters; anything longer is cut off. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToLimitShared(next, max);
}

/** True when the remaining characters are within the counter threshold. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at
 * which the element's content still fits in `box` pixels of height.
 * `overflow` is true when even the smallest size does not fit.
 *
 * Sizes are world units: the note (and its text) is scaled by the board zoom,
 * so the fit only has to be recomputed when the text changes, never on zoom.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  const fitsAt = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };

  if (fitsAt(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  if (!fitsAt(STICKY_FONT_MIN_PX)) {
    el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }

  let low = STICKY_FONT_MIN_PX; // fits
  let high = STICKY_FONT_MAX_PX; // does not fit
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (fitsAt(middle)) low = middle;
    else high = middle;
  }
  el.style.fontSize = `${low}px`;
  return { fontPx: low, overflow: false };
}
