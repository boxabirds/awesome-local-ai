/**
 * Pure logic for sticky note text (anchor: sticky.text): length limit, minimal Y.Text
 * diff, counter visibility and font fitting. The limit and diff helpers live in
 * `src/shared/text-edit.ts` (story 9) and are re-exported here with the sticky note limit.
 */
import {
  applyTextDiff,
  clampAtCaret as sharedClampAtCaret,
  clampToLimit as sharedClampToLimit,
} from '../../shared/text-edit';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

const HALF = 2;

/** Keeps at most `max` UTF-16 code units (default: the sticky note limit). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return sharedClampToLimit(next, max);
}

/** Drops excess characters just before `caret` (default limit: the sticky note limit). */
export function clampAtCaret(
  next: string,
  caret: number,
  max: number = STICKY_TEXT_MAX_CHARS,
): { text: string; caret: number } {
  return sharedClampAtCaret(next, caret, max);
}

export { applyTextDiff };

/** The n/1000 counter shows once the remaining characters are within the threshold. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Sets `el`'s font size to the largest integer px in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * at which its content fits `box` (scrollHeight <= box), by binary search. Returns the
 * chosen size and whether the text still overflows at the minimum size.
 *
 * Sizes are in world units: the note lives in the zoomed world layer, so measurements
 * (offset/scroll sizes ignore CSS transforms) are zoom independent.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const fits = (px: number): boolean => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };
  if (fits(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  let lo = STICKY_FONT_MIN_PX; // largest size known (or assumed) to be the answer
  let hi = STICKY_FONT_MAX_PX - 1; // largest size still to try
  if (!fits(lo)) {
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / HALF);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}
