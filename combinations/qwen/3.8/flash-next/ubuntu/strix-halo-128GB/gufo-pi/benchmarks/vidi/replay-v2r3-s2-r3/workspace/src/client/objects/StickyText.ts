import type * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '../../shared/config';

/**
 * Pure text logic for sticky notes: the 1,000 character limit, the minimal
 * Y.Text diff (so a teammate's concurrent typing survives, story 3), the
 * counter rule and the auto-fit font search.
 */

/** Keep at most `max` characters; characters beyond the limit are dropped. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  return next.slice(0, max);
}

/** True when the remaining budget is small enough to show the character counter. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Write `next` into `ytext` using the minimal change: common prefix and common
 * suffix are kept, so the diff is at most one delete and one insert. Surrogate
 * pairs are never split. No transaction is opened when nothing changed.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  const minLen = Math.min(current.length, next.length);

  let start = 0;
  while (start < minLen && current.charCodeAt(start) === next.charCodeAt(start)) start++;
  // Do not cut between the high and the low half of a surrogate pair.
  if (
    start > 0 &&
    start < current.length &&
    isHighSurrogate(current.charCodeAt(start - 1)) &&
    isLowSurrogate(current.charCodeAt(start))
  ) {
    start--;
  }

  let end = 0;
  while (
    end < minLen - start &&
    current.charCodeAt(current.length - 1 - end) === next.charCodeAt(next.length - 1 - end)
  ) {
    end++;
  }
  // Same for the end of the replaced region.
  if (end > 0 && isHighSurrogate(current.charCodeAt(current.length - end - 1))) {
    end--;
  }

  const deleteLength = current.length - start - end;
  const insertText = next.slice(start, next.length - end);

  const doc = ytext.doc;
  if (!doc) return;

  doc.transact(() => {
    if (deleteLength > 0) ytext.delete(start, deleteLength);
    if (insertText.length > 0) ytext.insert(start, insertText);
  }, origin);
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at which
 * `el` still fits into `box` (CSS pixels of board units: the note lives in the
 * scaled world layer, so one measurement serves every zoom level).
 * When even the smallest size does not fit, `overflow` is true and the caller
 * clips the text and shows the bottom fade.
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
  if (!fitsAt(STICKY_FONT_MIN_PX)) return { fontPx: STICKY_FONT_MIN_PX, overflow: true };

  let lo = STICKY_FONT_MIN_PX; // fits
  let hi = STICKY_FONT_MAX_PX; // does not fit
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fitsAt(mid)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  fitsAt(lo);
  return { fontPx: lo, overflow: false };
}
