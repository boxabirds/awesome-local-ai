import * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MIN_PX,
  STICKY_FONT_MAX_PX,
} from '../../shared/config';

/**
 * Keep at most `max` characters (default STICKY_TEXT_MAX_CHARS). Characters
 * beyond the limit are dropped.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  return next.slice(0, max);
}

/**
 * True when the note has `STICKY_COUNTER_THRESHOLD_CHARS` or fewer characters
 * remaining before the limit (i.e. the counter should be shown).
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Apply the minimal change from the Y.Text's current value to `next`, computed
 * as a common prefix + common suffix, so the result is at most one delete and
 * one insert. This preserves concurrent edits by others (story 3) instead of
 * replacing the whole string. Surrogate-pair safe: boundaries only land where
 * units differ, so a shared pair is always kept whole.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const old = ytext.toString();
  if (old === next) return;

  const oldLen = old.length;
  const nextLen = next.length;

  // Common prefix.
  let start = 0;
  while (start < oldLen && start < nextLen && old.charCodeAt(start) === next.charCodeAt(start)) {
    start++;
  }
  // Common suffix (never overlapping the prefix).
  let oldEnd = oldLen;
  let nextEnd = nextLen;
  while (
    oldEnd > start &&
    nextEnd > start &&
    old.charCodeAt(oldEnd - 1) === next.charCodeAt(nextEnd - 1)
  ) {
    oldEnd--;
    nextEnd--;
  }

  const delLen = oldEnd - start;
  const insStr = next.slice(start, nextEnd);

  const apply = () => {
    if (delLen > 0) ytext.delete(start, delLen);
    if (insStr.length > 0) ytext.insert(start, insStr);
  };

  if (ytext.doc) {
    ytext.doc.transact(apply, origin);
  } else {
    apply();
  }
}

/**
 * Binary-search the largest integer font size in [STICKY_FONT_MIN_PX,
 * STICKY_FONT_MAX_PX] (board units, so it scales with zoom) at which `el`'s
 * scrollHeight fits within `box`. If the text does not fit even at the minimum
 * size, `overflow` is true (the caller clips and shows a bottom fade).
 *
 * `el` must already contain the note's text; the function temporarily sets the
 * font size while measuring and restores the final size.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;

  const fits = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };

  // Find the largest size that fits.
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  el.style.fontSize = `${best}px`;
  const overflow = best === STICKY_FONT_MIN_PX && el.scrollHeight > box;
  return { fontPx: best, overflow };
}
