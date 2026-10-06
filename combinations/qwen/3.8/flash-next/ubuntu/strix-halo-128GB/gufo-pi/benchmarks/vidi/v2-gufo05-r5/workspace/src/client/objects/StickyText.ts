/**
 * Note text logic: the character limit, the minimal Y.Text edit, the counter and the
 * auto-fit font size.
 *
 * The limit and the diff live in `shared/text-edit.ts` since story 9, because text objects
 * need exactly the same rules; they are re-exported here with the note's own limit so story
 * 2's callers are unchanged.
 */
import { clampToLimit as clampSharedText } from '../../shared/text-edit';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

export { applyTextDiff } from '../../shared/text-edit';

/** The area inside a note that text may cover, in world units (a square). */
export const STICKY_TEXT_BOX_WORLD = STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2;

/**
 * Keeps at most `max` note characters, the note's own limit being the default.
 *
 * A cut that would land inside an emoji is moved before it, so the kept text is always
 * valid Unicode (the rule itself is shared with text objects).
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampSharedText(next, max);
}

/** True when the remaining characters are few enough to be worth showing. */
export function counterVisible(
  length: number,
  max: number = STICKY_TEXT_MAX_CHARS,
  threshold: number = STICKY_COUNTER_THRESHOLD_CHARS,
): boolean {
  return max - length <= threshold;
}

export interface FontFit {
  /** The font size to use, within [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]. */
  fontPx: number;
  /** True when even the smallest size does not fit: the rest is clipped and faded. */
  overflow: boolean;
}

/**
 * Finds the largest integer font size, between STICKY_FONT_MAX_PX and
 * STICKY_FONT_MIN_PX, at which the element's content still fits into `box` pixels, and
 * leaves that size applied to the element.
 *
 * Sizes are in world units: the element lives in the scaled world layer, so the text
 * grows and shrinks with the board zoom.
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  const apply = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };

  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  if (!apply(lo)) {
    // even the smallest size overflows: keep it, clip the rest
    return { fontPx: lo, overflow: true };
  }
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (apply(mid)) lo = mid;
    else hi = mid - 1;
  }
  apply(lo);
  return { fontPx: lo, overflow: false };
}
