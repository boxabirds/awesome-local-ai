import * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MIN_PX,
  STICKY_FONT_MAX_PX,
} from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';

/** Padding inside a note around the text (board units). */
export const STICKY_TEXT_PADDING = 16;

/** Keeps at most `max` characters (default STICKY_TEXT_MAX_CHARS). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length > max ? next.slice(0, max) : next;
}

/** True when `STICKY_COUNTER_THRESHOLD_CHARS` or fewer characters remain. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Applies the minimal change (common prefix + common suffix) from the
 * Y.Text's current value to `next`: at most one delete and one insert, in a
 * single transaction. Surrogate-pair safe. A no-op when the values are
 * equal (no transaction, no delta events), so concurrent typing by others
 * (story 3) is never destroyed by a full replace.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown = LOCAL_ORIGIN): void {
  const current = ytext.toString();
  if (current === next) return;

  const lenCurrent = current.length;
  const lenNext = next.length;

  // Common prefix
  let start = 0;
  while (start < lenCurrent && start < lenNext && current.charCodeAt(start) === next.charCodeAt(start)) {
    start++;
  }
  // Common suffix (must not overlap the prefix)
  let endCurrent = lenCurrent;
  let endNext = lenNext;
  while (endCurrent > start && endNext > start && current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)) {
    endCurrent--;
    endNext--;
  }

  // `transact` exists at runtime on every AbstractType (it is a no-doc
  // passthrough for standalone Y.Text) but is missing from yjs's d.ts.
  const apply = () => {
    if (endCurrent > start) {
      ytext.delete(start, endCurrent - start);
    }
    if (endNext > start) {
      ytext.insert(start, next.slice(start, endNext));
    }
  };

  const doc = ytext.doc;
  if (doc) {
    doc.transact(apply, origin);
  } else {
    // Detached Y.Text (only possible outside a document): apply without a
    // transaction. In the app the text always lives in a note in the doc.
    apply();
  }
}

/**
 * Binary-searches the largest integer font size in [STICKY_FONT_MIN_PX,
 * STICKY_FONT_MAX_PX] at which the element's content fits `box`
 * (scrollHeight <= box). The font is in board units, so it scales with zoom.
 * Leaves the element at the chosen size and reports `overflow` when the
 * content does not fit even at the minimum size.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  el.style.fontSize = `${best}px`;
  return { fontPx: best, overflow: el.scrollHeight > box };
}
