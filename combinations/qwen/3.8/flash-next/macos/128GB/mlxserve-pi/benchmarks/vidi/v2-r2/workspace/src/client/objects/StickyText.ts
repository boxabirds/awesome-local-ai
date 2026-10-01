// Sticky note text logic: the parts that do not need a rendered page.
//   clampToLimit   the 1,000 character rule (shared with story 9's text objects)
//   applyTextDiff  the minimal Y.Text edit for a new textarea value (shared)
//   counterVisible when the "940/1000" counter appears
//   fitFontSize    the largest font size the note can show all text in
//
// clampToLimit and applyTextDiff live in shared/text-edit, where every object
// with editable text can reach them; this module re-exports them with the note's
// own limit, so story 2's callers are unchanged.
//
// applyTextDiff matters beyond neatness: story 3 merges concurrent typing, and a
// full replace would destroy what somebody else typed in the same note.
//
// Characters are counted as the user counts them (Unicode code points), so an
// emoji is one character and a cut at the limit can never split a surrogate pair.

import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { applyTextDiff, clampToLimit as clampToLimitShared } from '../../shared/text-edit';

/** Padding inside a note, in world units. CSS and the fit maths share this. */
export const NOTE_PADDING_WORLD = 12;

/** Keep at most `max` characters, defaulting to a note's limit. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToLimitShared(next, max);
}

export { applyTextDiff };

/** True when the character counter should be shown for a text of this length. */
export function counterVisible(length: number): boolean {
  if (!Number.isFinite(length)) return false;
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * The largest integer font size, between STICKY_FONT_MIN_PX and
 * STICKY_FONT_MAX_PX, that lays the element's text out inside `box` pixels. When
 * even the smallest size is too big, the element is set to the minimum and
 * `overflow` is true: the caller then hides the part that does not fit and shows
 * the fade at the bottom edge.
 *
 * The size is written into the element while measuring, so the element ends up
 * styled with the returned size. Fonts are in world units: the board's own
 * transform scales them with zoom, which is why zoom never needs a re-measure.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const fitsAt = (px: number): boolean => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };

  if (!Number.isFinite(box) || box <= 0) {
    el.style.fontSize = `${STICKY_FONT_MAX_PX}px`;
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }
  if (fitsAt(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  if (!fitsAt(STICKY_FONT_MIN_PX)) {
    el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }

  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX - 1;
  let best = STICKY_FONT_MIN_PX;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (fitsAt(middle)) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  el.style.fontSize = `${best}px`;
  return { fontPx: best, overflow: false };
}
