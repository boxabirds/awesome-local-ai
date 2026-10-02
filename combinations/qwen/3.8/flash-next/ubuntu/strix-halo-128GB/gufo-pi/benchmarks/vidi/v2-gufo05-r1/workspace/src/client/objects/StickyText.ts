/**
 * The text logic of a sticky note: everything that turns a textarea value into
 * a minimal, bounded change on a `Y.Text`, plus the auto-fit measurement.
 *
 * Two rules matter beyond the obvious one (text must fit):
 *
 * - **Minimal edits.** `applyTextDiff` writes the smallest change that turns the
 *   current text into the next one (common prefix + common suffix). A full
 *   replace would destroy text a teammate is typing at the same moment once
 *   story 3 syncs this document.
 * - **Surrogate pairs stay whole.** A diff boundary never falls between the two
 *   halves of an emoji, which would leave a lone half behind.
 *
 * No React and no layout here except `fitFontSize`, which measures an element.
 */
import type * as Y from 'yjs';

import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/** Keep at most `max` characters; anything longer is cut off. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length <= max ? next : next.slice(0, max);
}

/** True for the first half of a UTF-16 surrogate pair. */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** True for the second half of a UTF-16 surrogate pair. */
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** The edit region `[start, end)` of turning `current` into `next`. */
function diffRange(current: string, next: string): { start: number; endCurrent: number; endNext: number } {
  let start = 0;
  const shared = Math.min(current.length, next.length);
  while (start < shared && current[start] === next[start]) start += 1;

  let endCurrent = current.length;
  let endNext = next.length;
  while (endCurrent > start && endNext > start && current[endCurrent - 1] === next[endNext - 1]) {
    endCurrent -= 1;
    endNext -= 1;
  }

  // Never cut a surrogate pair in half: pull the start back before a high
  // surrogate and push the end past a low one, so the change covers whole
  // characters only.
  if (start > 0 && (isHighSurrogate(current.charCodeAt(start - 1)) || isHighSurrogate(next.charCodeAt(start - 1)))) {
    start -= 1;
  }
  if (endCurrent < current.length && isLowSurrogate(current.charCodeAt(endCurrent))) endCurrent += 1;
  if (endNext < next.length && isLowSurrogate(next.charCodeAt(endNext))) endNext += 1;

  return { start, endCurrent, endNext };
}

/**
 * Write `next` into `ytext` with the fewest operations possible: at most one
 * delete and one insert, inside a single transaction.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return; // no change, so no transaction and no sync traffic

  const { start, endCurrent, endNext } = diffRange(current, next);
  const deleteLength = endCurrent - start;
  const insertion = next.slice(start, endNext);

  const write = () => {
    if (deleteLength > 0) ytext.delete(start, deleteLength);
    if (insertion.length > 0) ytext.insert(start, insertion);
  };

  const doc = ytext.doc;
  if (doc) doc.transact(write, origin);
  else write();
}

/** True when the remaining characters are within the counter threshold. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at
 * which the element's content still fits in `box` pixels of height.
 * `overflow` is true when even the smallest size does not fit.
 *
 * Sizes are world units: the note (and its text) is scaled by the board zoom,
 * so the fit only has to be recomputed when the text changes, never on zoom.
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
  if (!fitsAt(STICKY_FONT_MIN_PX)) {
    el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }

  let low = STICKY_FONT_MIN_PX; // fits
  let high = STICKY_FONT_MAX_PX; // does not fit
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (fitsAt(middle)) low = middle;
    else high = middle;
  }
  el.style.fontSize = `${low}px`;
  return { fontPx: low, overflow: false };
}
