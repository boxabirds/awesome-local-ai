import * as Y from "yjs";
import { LOCAL_ORIGIN } from "../../shared/board-model";
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from "../../shared/config";

/**
 * Note text: the pure half of sticky.text.
 *
 * Editing a note writes through a *minimal* diff (common prefix + common
 * suffix) instead of replacing the whole string, so when story 3 lets several
 * people type on one board, my typing never destroys theirs.
 */

/** Keeps at most `max` characters; a cut never splits a surrogate pair. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  let cut = max;
  if (splitsSurrogatePair(next, cut)) cut -= 1;
  return next.slice(0, cut);
}

/** True when the "n/1000" counter should be shown for text of this length. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Applies `next` to a shared Y.Text with the smallest change that turns the
 * current string into `next`: one delete and/or one insert, in one transaction.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  let prefix = 0;
  const maxPrefix = Math.min(current.length, next.length);
  while (prefix < maxPrefix && current.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix += 1;
  }

  let suffix = 0;
  const maxSuffix = Math.min(current.length - prefix, next.length - prefix);
  while (
    suffix < maxSuffix &&
    current.charCodeAt(current.length - suffix - 1) === next.charCodeAt(next.length - suffix - 1)
  ) {
    suffix += 1;
  }

  // Never cut a surrogate pair in half: back off while the boundary sits
  // between a high and a low surrogate.
  while (prefix > 0 && splitsSurrogatePair(next, prefix)) prefix -= 1;
  let suffixStart = next.length - suffix;
  while (suffixStart > prefix && splitsSurrogatePair(next, suffixStart)) suffixStart -= 1;
  suffix = next.length - suffixStart;

  const deleteLength = current.length - prefix - suffix;
  const insertText = next.slice(prefix, suffixStart);

  ytext.doc?.transact(() => {
    if (deleteLength > 0) ytext.delete(prefix, deleteLength);
    if (insertText.length > 0) ytext.insert(prefix, insertText);
  }, origin);
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at
 * which the element's content still fits inside `box` (its own fixed size, in
 * the same CSS pixel units). Returns `overflow: true` when even the smallest
 * size does not fit, which is when the note shows its bottom fade.
 *
 * Depends on real text layout: under jsdom (no layout engine) everything
 * "fits", so the fitted sizes are verified in the browser tests.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  const fitsAt = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box && el.scrollWidth <= box;
  };

  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  let best = low - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (fitsAt(mid)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const fontPx = best < STICKY_FONT_MIN_PX ? STICKY_FONT_MIN_PX : best;
  el.style.fontSize = `${fontPx}px`;
  return { fontPx, overflow: best < STICKY_FONT_MIN_PX };
}

/** The font size range the product allows, so callers never re-derive it. */
export const STICKY_FONT_RANGE = { min: STICKY_FONT_MIN_PX, max: STICKY_FONT_MAX_PX };

/** Origin used when the local user edits note text (story 8 undo). */
export const TEXT_EDIT_ORIGIN = LOCAL_ORIGIN;

/** True when index `i` sits between the two halves of a surrogate pair. */
function splitsSurrogatePair(value: string, i: number): boolean {
  if (i <= 0 || i >= value.length) return false;
  const prev = value.charCodeAt(i - 1);
  const next = value.charCodeAt(i);
  return prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}
