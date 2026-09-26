// Story 2: sticky note text editing helpers (anchor: sticky.text).
//
// Pure logic, no DOM except `fitFontSize` (which measures a live element).
// Story 3 depends on `applyTextDiff` being a *minimal* diff: a full replace
// would destroy concurrent typing by others once the doc is shared live.

import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/** Keep at most `max` characters; longer input is truncated (no wrap). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length > max ? next.slice(0, max) : next;
}

/** The character counter shows when the remaining capacity is at or below the threshold. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Bring `ytext` to exactly `next` with the minimal edit: common prefix and
 * common suffix are kept, so at most one delete and one insert are emitted
 * (inside a single transaction). Surrogate pairs in `next` are kept intact
 * because edit boundaries are derived from comparing the two full strings.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  const minLen = Math.min(current.length, next.length);
  let prefix = 0;
  while (prefix < minLen && current[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const deleteLength = current.length - prefix - suffix;
  const insertText = next.slice(prefix, next.length - suffix);
  if (deleteLength === 0 && insertText.length === 0) return;

  const doc = ytext.doc;
  if (doc === null) return;
  doc.transact(
    () => {
      if (deleteLength > 0) ytext.delete(prefix, deleteLength);
      if (insertText.length > 0) ytext.insert(prefix, insertText);
    },
    origin,
  );
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at
 * which `el`'s content fits within `box` CSS px of height (binary search,
 * measuring `scrollHeight`). Sets the element's font size to the result and
 * reports whether the content still overflows at the smallest size.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
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
  return { fontPx: best, overflow: el.scrollHeight > box };
}
