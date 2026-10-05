/**
 * Sticky note text logic: the length limit, the minimal diff into the shared
 * `Y.Text`, the counter rule, and the font auto-fit.
 *
 * The diff matters beyond this story: typing must reach the document as the
 * smallest change that turns the old text into the new one (common prefix and
 * common suffix untouched), because story 3 merges concurrent typing from
 * several people and a delete-all/insert-all rewrite would destroy theirs.
 *
 * The two rules that are about *text* rather than about a note — the length
 * limit and the minimal diff — moved to `src/shared/text-edit.ts` when story 9
 * gave the board a second type with typed text. They are re-exported here with
 * the note's own limit as the default, so every story 2 caller and test carries
 * on unchanged.
 *
 * The pure functions here run in the browser and in tests; nothing touches
 * React except `fitFontSize`, which measures a real element.
 */

import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS
} from '../../shared/config';
import { clampToLimit as clampToSharedLimit } from '../../shared/text-edit';

// One implementation of the minimal diff, of the limit and of the caret mapping, shared
// with free text — they are about text, not about a note.
export { applyTextDiff, mapCaret, type TextOp } from '../../shared/text-edit';

/**
 * Keep at most `max` characters — everything past the limit is dropped, so a
 * 1,200 character paste into an empty note keeps exactly the first 1,000.
 *
 * The cut is moved back when it would split an emoji in half: half a surrogate
 * pair is not a character, and storing one would show a replacement glyph.
 */
export function clampToLimit(next: string, max = STICKY_TEXT_MAX_CHARS): string {
  return clampToSharedLimit(next, max);
}

/**
 * The counter stays out of the way of ordinary notes: it appears only when the
 * text is within STICKY_COUNTER_THRESHOLD_CHARS characters of the limit, which is
 * when the user has to start counting — 949 characters hides it, 950 shows it.
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

export interface FontFit {
  /** Largest integer px in [min, max] at which the text fits, else the minimum. */
  fontPx: number;
  /** True when the text does not fit even at the minimum size. */
  overflow: boolean;
}

/**
 * Find the largest whole-pixel font size in
 * [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at which the element's text fits
 * inside a box of `box` pixels, and leave that size applied to the element.
 *
 * `el` must already have the box's width and the note's text, so a measure is a
 * real line-wrap. Sizes are whole pixels, which makes the search at most five
 * measures and keeps rendered text crisp.
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  const fits = (px: number): boolean => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };
  if (fits(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  if (!fits(STICKY_FONT_MIN_PX)) {
    // Even the minimum is too big: the note clips and fades the overflow.
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }
  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX - 1; // MAX is known not to fit
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  fits(low);
  return { fontPx: low, overflow: false };
}
