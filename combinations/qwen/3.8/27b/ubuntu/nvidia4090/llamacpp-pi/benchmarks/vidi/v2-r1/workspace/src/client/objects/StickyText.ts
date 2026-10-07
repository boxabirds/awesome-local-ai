// Sticky note text logic (story 2, sticky.text contract).
// Pure text logic (diff, clamp, counter) plus font fitting by measurement.

import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '../../shared/config';

/** Padding between the note edge and its text (world units). */
export const NOTE_PADDING_PX = 12;
/** Height (world units) of the region note text must fit into. */
export const NOTE_TEXT_BOX = STICKY_SIZE_WORLD - NOTE_PADDING_PX * 2;

/** Keep at most `max` characters (default STICKY_TEXT_MAX_CHARS); characters
 *  beyond the limit are dropped. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length > max ? next.slice(0, max) : next;
}

/**
 * The counter is shown when at most STICKY_COUNTER_THRESHOLD_CHARS characters
 * remain until the limit.
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Apply the minimal change that turns `ytext` into `next`: one delete and/or
 * one insert of the differing middle (common prefix + common suffix), in a
 * single transaction. A full replace would destroy concurrent typing (story 3),
 * so the minimal diff is required.
 *
 * The diff is computed over code points so emoji surrogate pairs are never
 * split.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  const cur = Array.from(current);
  const nxt = Array.from(next);
  let prefix = 0;
  while (prefix < cur.length && prefix < nxt.length && cur[prefix] === nxt[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < cur.length - prefix &&
    suffix < nxt.length - prefix &&
    cur[cur.length - 1 - suffix] === nxt[nxt.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const prefixStr = cur.slice(0, prefix).join('');
  const suffixStr = cur.slice(cur.length - suffix).join('');
  const deleteStart = prefixStr.length;
  const deleteLength = current.length - prefixStr.length - suffixStr.length;
  const insert = nxt.slice(prefix, nxt.length - suffix).join('');

  const apply = () => {
    if (deleteLength > 0) ytext.delete(deleteStart, deleteLength);
    if (insert.length > 0) ytext.insert(deleteStart, insert);
  };
  const doc = ytext.doc;
  if (doc) {
    doc.transact(apply, origin);
  } else {
    // Standalone text (unit tests without a doc): implicit transactions.
    apply();
  }
}

/**
 * Find the largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * (board units at 100% zoom — it scales with the camera zoom) at which the
 * element's content fits within `box` pixels. If even the minimum does not
 * fit, returns the minimum with `overflow: true` (the caller clips and shows
 * a fade at the bottom edge).
 *
 * `el` must be laid out (real browser); jsdom has no layout, so this is only
 * verified in e2e.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  const fits = (px: number): boolean => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best === -1) {
    el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }
  return { fontPx: best, overflow: false };
}
