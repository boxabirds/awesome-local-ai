// Pure text logic + font measurement for sticky notes. See the sticky.text
// contract. clampToLimit / applyTextDiff / counterVisible are pure and unit
// tested; fitFontSize measures a real element (exercised in e2e, jsdom has no
// text layout).
//
// All length counting is in UTF-16 code units (String.prototype.length) to match
// the character budget in the PRD; the diff and clamp never split a surrogate
// pair, so an astral character (emoji) is always kept whole or dropped whole.

import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Cap `next` at `max` characters (default STICKY_TEXT_MAX_CHARS). If the cut
 * would land between the halves of a surrogate pair, the dangling high surrogate
 * is dropped too, so a multi-code-unit character is never split.
 */
export function clampToLimit(
  next: string,
  max: number = STICKY_TEXT_MAX_CHARS,
): string {
  if (next.length <= max) return next;
  let cut = next.slice(0, max);
  if (isHighSurrogate(cut.charCodeAt(max - 1))) {
    cut = cut.slice(0, max - 1);
  }
  return cut;
}

/**
 * Write `next` into `ytext` using the minimal change: keep the common prefix and
 * common suffix, then at most one delete and one insert, inside a single
 * transaction tagged with `origin`. A full replace would clobber concurrent typing
 * by other users once story 3 syncs, hence the minimal diff. No-op (no
 * transaction) when the text is unchanged.
 */
export function applyTextDiff(
  ytext: Y.Text,
  next: string,
  origin: unknown,
): void {
  const prev = ytext.toString();
  if (prev === next) return;

  const minLen = Math.min(prev.length, next.length);

  let start = 0;
  while (start < minLen && prev[start] === next[start]) start += 1;

  let endPrev = prev.length;
  let endNext = next.length;
  while (
    endPrev > start &&
    endNext > start &&
    prev[endPrev - 1] === next[endNext - 1]
  ) {
    endPrev -= 1;
    endNext -= 1;
  }

  const deleteLen = endPrev - start;
  const insertStr = next.slice(start, endNext);

  const run = () => {
    if (deleteLen > 0) ytext.delete(start, deleteLen);
    if (insertStr.length > 0) ytext.insert(start, insertStr);
  };

  const doc = ytext.doc;
  if (doc) doc.transact(run, origin);
  else run();
}

/**
 * True when the note is within STICKY_COUNTER_THRESHOLD_CHARS of the limit
 * (i.e. remaining <= threshold), including when it is at the limit already.
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Find the largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * at which `el`'s content fits within `box` pixels of height, and leave the
 * element sized at that value. When even the minimum size does not fit, return
 * the minimum with `overflow: true` so the caller can show the bottom fade.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  const fitsAt = (px: number): boolean => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };

  if (!fitsAt(STICKY_FONT_MIN_PX)) {
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }
  if (fitsAt(STICKY_FONT_MAX_PX)) {
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }

  // Invariant: `lo` fits, `hi` does not. Narrow to adjacent integers.
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (fitsAt(mid)) lo = mid;
    else hi = mid;
  }
  fitsAt(lo); // leave the element sized at the chosen (largest fitting) value
  return { fontPx: lo, overflow: false };
}
