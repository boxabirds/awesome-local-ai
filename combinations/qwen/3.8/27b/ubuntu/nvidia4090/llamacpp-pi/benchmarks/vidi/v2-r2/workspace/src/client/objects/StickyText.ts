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
import { applyTextDiff, clampToLimit as sharedClampToLimit } from '../../shared/text-edit';

// Story 9 moved the shared rules to src/shared/text-edit.ts (used by sticky
// notes and free text alike); re-exported here so story 2 callers/tests keep
// the same import path. The sticky clamp keeps its default limit.
export { applyTextDiff };

/**
 * Keeps at most `max` characters (default STICKY_TEXT_MAX_CHARS); characters
 * beyond the limit are dropped.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return sharedClampToLimit(next, max);
}

/**
 * Re-positions a caret (index into `oldStr`) after `oldStr` becomes `newStr`
 * via the minimal common-prefix/suffix change. This is what keeps the local
 * editing caret stable while a concurrent remote edit is merged into the
 * textarea (story 3): an insertion at or before the caret pushes the caret
 * forward, a deletion before it pulls the caret back, and a caret that lands
 * inside the deleted region is placed just after the inserted text.
 */
export function adjustCaretForMerge(oldStr: string, newStr: string, caret: number): number {
  const minLen = Math.min(oldStr.length, newStr.length);

  let prefix = 0;
  while (prefix < minLen && oldStr.charCodeAt(prefix) === newStr.charCodeAt(prefix)) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    oldStr.charCodeAt(oldStr.length - 1 - suffix) === newStr.charCodeAt(newStr.length - 1 - suffix)
  ) {
    suffix++;
  }

  const deleteStart = prefix;
  const deleteEnd = oldStr.length - suffix;
  const insertLen = newStr.length - prefix - suffix;
  const deleteLen = deleteEnd - deleteStart;

  if (caret < deleteStart) {
    return caret; // change is after the caret
  }
  if (caret >= deleteEnd) {
    return caret + insertLen - deleteLen; // change is before the caret
  }
  return deleteStart + insertLen; // caret was inside the deleted region
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
