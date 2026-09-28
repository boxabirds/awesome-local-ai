import * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from 'src/shared/config';

/** Truncates `next` to at most `max` characters (default STICKY_TEXT_MAX_CHARS). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length > max ? next.slice(0, max) : next;
}

/**
 * Applies the minimal change (common prefix + common suffix) that turns the
 * current Y.Text content into `next`: at most one delete and one insert in a
 * single transaction, surrogate-pair safe.
 *
 * A minimal diff is required (not a full replace) so that concurrent typing by
 * other clients keeps merging once story 3 ships.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown = null): void {
  const cur = ytext.toString();
  if (cur === next) return;

  const curLen = cur.length;
  const nextLen = next.length;
  const minLen = Math.min(curLen, nextLen);

  // Common prefix (code-unit based).
  let start = 0;
  while (start < minLen && cur.charCodeAt(start) === next.charCodeAt(start)) start++;

  // Common suffix, not crossing the prefix.
  let endCur = curLen;
  let endNext = nextLen;
  while (endCur > start && endNext > start && cur.charCodeAt(endCur - 1) === next.charCodeAt(endNext - 1)) {
    endCur--;
    endNext--;
  }

  // Surrogate-pair safety: if the diff boundary splits a pair, extend the
  // delete/insert region by one unit so no orphan surrogate is left behind.
  if (start > 0 && (cur.charCodeAt(start - 1) & 0xfc00) === 0xd800) start--;
  if (endCur < curLen && (cur.charCodeAt(endCur) & 0xfc00) === 0xdc00) endCur++;

  const deleteLength = endCur - start;
  const insert = next.slice(start, endNext);

  const apply = () => {
    if (deleteLength > 0) ytext.delete(start, deleteLength);
    if (insert.length > 0) ytext.insert(start, insert);
  };

  // One transaction per input event; falls back to a bare apply when the
  // text is not (yet) attached to a doc (e.g. unit tests).
  if (ytext.doc) ytext.doc.transact(apply, origin);
  else apply();
}

/** True when the remaining character budget is within STICKY_COUNTER_THRESHOLD_CHARS. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Binary search over integer px sizes in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * for the largest font at which the element's content fits in `box`
 * (scrollHeight <= box). The element's font-size is left set to the result.
 *
 * Returns the chosen fontPx and whether the text still overflows at the
 * minimum size (caller then hides overflow and shows a bottom fade).
 *
 * Must be run on text change and on mount only: the font is in world units,
 * so board zoom scales it uniformly and needs no re-measurement.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  el.style.fontSize = `${best}px`;
  const overflow = el.scrollHeight > box;
  return { fontPx: best, overflow };
}
