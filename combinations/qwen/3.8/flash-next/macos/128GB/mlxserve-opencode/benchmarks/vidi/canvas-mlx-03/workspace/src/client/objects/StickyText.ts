// Pure text helpers for sticky notes: length clamping, minimal Y.Text diff, the
// character-counter visibility rule, and font auto-fit by measurement.
// See design "Sticky note text editing and fit" contract.

import type * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '../../shared/config.ts';

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Keep the first `max` characters; if that boundary would split a surrogate pair,
 * back off one so no lone surrogate is left at the end.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  let cut = max;
  if (isHighSurrogate(next.charCodeAt(cut - 1))) cut -= 1;
  return next.slice(0, cut);
}

/**
 * Apply the minimal edit (common prefix + common suffix) from `ytext` to `next`
 * inside a single transaction. This is deliberately not a full replace: a full
 * replace would destroy concurrent typing by others once story 3 ships.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const cur = ytext.toString();
  if (cur === next) return;

  const minLen = Math.min(cur.length, next.length);

  let p = 0;
  while (p < minLen && cur[p] === next[p]) p++;
  // Never split a surrogate pair at the prefix boundary.
  if (p > 0 && isHighSurrogate(next.charCodeAt(p - 1))) p--;

  let s = 0;
  while (
    s < minLen - p &&
    cur[cur.length - 1 - s] === next[next.length - 1 - s]
  ) {
    s++;
  }

  const deleteLen = cur.length - p - s;
  const insertStr = next.slice(p, next.length - s);

  const doc = ytext.doc;
  const run = () => {
    if (deleteLen > 0) ytext.delete(p, deleteLen);
    if (insertStr.length > 0) ytext.insert(p, insertStr);
  };
  if (doc) doc.transact(run, origin);
  else run();
}

/** The counter shows when the remaining characters drop to the threshold. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] whose
 * measured `scrollHeight` fits in `box` (inner note content height). Mutates
 * `el.style.fontSize` to the chosen size. When even the minimum does not fit,
 * returns the minimum with `overflow: true` so the caller can show the fade.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  el.style.fontSize = `${STICKY_FONT_MAX_PX}px`;
  if (el.scrollHeight <= box) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };

  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;
  let fits = false;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      best = mid;
      fits = true;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (fits) return { fontPx: best, overflow: false };
  el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
  return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
}
