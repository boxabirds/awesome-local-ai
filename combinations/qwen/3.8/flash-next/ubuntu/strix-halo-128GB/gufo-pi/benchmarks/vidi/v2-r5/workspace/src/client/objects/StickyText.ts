import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { clampToLimit as clampToLimitShared, applyTextDiff as applyTextDiffShared } from '../../shared/text-edit';

/**
 * Pure text helpers behind sticky note editing: the character limit, the minimal diff into a
 * shared `Y.Text`, the counter's visibility rule and the auto-fit font size. They live apart
 * from the component so every rule is unit-testable and shared by display and edit mode.
 *
 * `clampToLimit` and `applyTextDiff` are re-exported from `src/shared/text-edit.ts` with
 * STICKY_TEXT_MAX_CHARS as the default max so story 2 callers remain unchanged.
 */

/** Sticky-note wrapper that defaults to STICKY_TEXT_MAX_CHARS. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToLimitShared(next, max);
}

/** Sticky-note convenience wrapper that defaults to STICKY_TEXT_MAX_CHARS. */
export function applyTextDiff(ytext: Y.Text, nextRaw: string, origin: unknown): void {
  applyTextDiffShared(ytext, nextRaw, origin, STICKY_TEXT_MAX_CHARS);
}

/** The character counter appears once this many characters (or fewer) remain. */
export function counterVisible(length: number): boolean {
  if (!Number.isFinite(length) || length <= 0) return false;
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

export interface FontFit {
  fontPx: number;
  overflow: boolean;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at which the
 * element's content still fits inside a box of `box` pixels, measured with `scrollHeight`.
 * When it does not fit even at the minimum, the font stays at the minimum and `overflow` is
 * true, so the caller clips the note and fades its bottom edge.
 *
 * The element is measured at its current width; the returned size is applied as an inline
 * style, which is what the caller renders. Sizes are in board units, so the text scales with
 * zoom for free and this only has to run when the text changes (not on zoom).
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  const fitsAt = (px: number): boolean => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };

  if (fitsAt(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  if (!fitsAt(STICKY_FONT_MIN_PX)) return { fontPx: STICKY_FONT_MIN_PX, overflow: true };

  // Invariant: `low` fits, `high` does not.
  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (fitsAt(middle)) low = middle;
    else high = middle;
  }
  fitsAt(low);
  return { fontPx: low, overflow: false };
}
