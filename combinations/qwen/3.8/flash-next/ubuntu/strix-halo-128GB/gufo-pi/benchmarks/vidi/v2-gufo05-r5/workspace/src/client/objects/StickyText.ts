/**
 * Note text logic: the character limit, the minimal Y.Text edit, the counter and the
 * auto-fit font size.
 *
 * `applyTextDiff` is what makes concurrent typing possible later (story 3): a change
 * from "abc" to "abXc" is sent as one insert of "X" at index 2, not as a delete of the
 * whole note followed by an insert, so text other people typed at the same moment
 * survives the merge.
 */
import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/** The area inside a note that text may cover, in world units (a square). */
export const STICKY_TEXT_BOX_WORLD = STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Keeps at most `max` characters; characters beyond the limit are never stored.
 * A cut that would land inside an emoji is moved before it, so the kept text is always
 * valid Unicode.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  const limit = Math.max(0, Math.floor(max));
  if (next.length <= limit) return next;
  const last = next.charCodeAt(limit - 1);
  const cut = isHighSurrogate(last) ? limit - 1 : limit;
  return next.slice(0, cut);
}

/** True when the remaining characters are few enough to be worth showing. */
export function counterVisible(
  length: number,
  max: number = STICKY_TEXT_MAX_CHARS,
  threshold: number = STICKY_COUNTER_THRESHOLD_CHARS,
): boolean {
  return max - length <= threshold;
}

interface DiffRange {
  /** First character that differs (and where new text is inserted). */
  start: number;
  /** End of the characters to delete from the current text. */
  deleteEnd: number;
  /** End of the text to insert (slice of `next`). */
  insertEnd: number;
}

/**
 * Common prefix and common suffix of `current` and `next`, widened so no split ever
 * lands between the two halves of a surrogate pair.
 */
function diffRange(current: string, next: string): DiffRange {
  const longest = Math.min(current.length, next.length);
  let start = 0;
  while (start < longest && current[start] === next[start]) start += 1;

  let deleteEnd = current.length;
  let insertEnd = next.length;
  while (
    deleteEnd > start &&
    insertEnd > start &&
    current[deleteEnd - 1] === next[insertEnd - 1]
  ) {
    deleteEnd -= 1;
    insertEnd -= 1;
  }

  // Widen the edit outwards so a multi-code-unit character is replaced as a whole.
  const splitBefore = (text: string, index: number): boolean =>
    index > 0 && isHighSurrogate(text.charCodeAt(index - 1));
  const splitAfter = (text: string, index: number): boolean =>
    index < text.length && isLowSurrogate(text.charCodeAt(index));

  if (splitBefore(current, start) || splitBefore(next, start)) start -= 1;
  while (splitAfter(current, deleteEnd) || splitAfter(next, insertEnd)) {
    deleteEnd += 1;
    insertEnd += 1;
  }
  return { start, deleteEnd, insertEnd };
}

/**
 * Writes `next` into a shared text with the smallest possible edit: one delete and one
 * insert, inside a single transaction.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  const { start, deleteEnd, insertEnd } = diffRange(current, next);
  const remove = deleteEnd - start;
  const inserted = next.slice(start, insertEnd);

  const run = () => {
    if (remove > 0) ytext.delete(start, remove);
    if (inserted.length > 0) ytext.insert(start, inserted);
  };

  if (ytext.doc) ytext.doc.transact(run, origin);
  else run();
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
