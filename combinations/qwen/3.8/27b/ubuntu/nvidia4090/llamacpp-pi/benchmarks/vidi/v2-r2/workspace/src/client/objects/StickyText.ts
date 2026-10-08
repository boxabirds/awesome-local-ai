/**
 * Pure sticky-note text logic (story 2, sticky.text):
 * length clamping, the minimal textarea→Y.Text diff, the counter rule and
 * the font auto-fit. No React; the React editor (StickyTextEditor) and the
 * e2e font measurement build on these.
 */

import type * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/**
 * Keeps at most `max` characters (default STICKY_TEXT_MAX_CHARS); characters
 * beyond the limit are dropped.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length > max ? next.slice(0, max) : next;
}

/**
 * Applies the minimal change (common prefix + common suffix) that turns the
 * Y.Text's current content into `next`: at most one delete and one insert in
 * a single transaction. Never a full replace, so concurrent typing by others
 * (story 3) is never destroyed. Surrogate-pair safe: a boundary that would
 * split an emoji is pulled so the whole pair is on one side of the change.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const cur = ytext.toString();
  if (cur === next) {
    return; // no change: no transaction, no event
  }

  const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
  const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

  const minLen = Math.min(cur.length, next.length);

  // Common prefix (code units).
  let prefix = 0;
  while (prefix < minLen && cur.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix++;
  }
  // If the prefix boundary falls in the middle of a surrogate pair, the pair
  // is not fully common: pull the whole pair into the changed region.
  if (
    prefix > 0 &&
    prefix < cur.length &&
    isHigh(cur.charCodeAt(prefix - 1)) &&
    isLow(cur.charCodeAt(prefix))
  ) {
    prefix--;
  }

  // Common suffix (code units), not overlapping the prefix.
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    cur.charCodeAt(cur.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++;
  }
  // If the suffix boundary falls in the middle of a surrogate pair, keep the
  // whole pair in the changed region (the suffix shrinks by one unit).
  const suffixStart = cur.length - suffix;
  if (
    suffixStart > 0 &&
    suffixStart < cur.length &&
    isHigh(cur.charCodeAt(suffixStart - 1)) &&
    isLow(cur.charCodeAt(suffixStart))
  ) {
    suffix--;
  }

  const deleteLen = cur.length - prefix - suffix;
  const insert = next.slice(prefix, next.length - suffix);

  const apply = (): void => {
    if (deleteLen > 0) {
      ytext.delete(prefix, deleteLen);
    }
    if (insert.length > 0) {
      ytext.insert(prefix, insert);
    }
  };

  const doc = ytext.doc;
  if (doc === null) {
    // A Y.Text not yet attached to a document (unit-level use): apply directly.
    apply();
    return;
  }
  // One transaction per edit, tagged with the caller's origin.
  doc.transact(apply, origin);
}

/**
 * True when the counter should be visible: STICKY_COUNTER_THRESHOLD_CHARS or
 * fewer characters remain until STICKY_TEXT_MAX_CHARS.
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Binary-searches the largest integer font size in
 * [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at which the element's
 * scrollHeight fits in `box` (board units; zoom-independent because layout
 * is measured in the world layer's local units). Returns the size and
 * whether the text overflows even at the minimum size.
 *
 * Requires a real layout engine (browser / e2e); under jsdom scrollHeight is
 * 0, so this returns the maximum size with no overflow.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      best = mid; // mid fits: try larger
      lo = mid + 1;
    } else {
      hi = mid - 1; // mid too big: try smaller
    }
  }

  el.style.fontSize = `${best}px`;
  const overflow = el.scrollHeight > box;
  return { fontPx: best, overflow };
}
