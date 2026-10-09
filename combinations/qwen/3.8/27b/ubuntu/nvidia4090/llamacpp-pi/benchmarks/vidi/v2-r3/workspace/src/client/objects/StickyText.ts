import type * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
} from '../../shared/board-model';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/** Keeps at most `max` characters. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length > max ? next.slice(0, max) : next;
}

/**
 * Applies the minimal change (common prefix + common suffix) from the
 * current text to `next` on the Y.Text. One Yjs transaction. This is what
 * keeps concurrent typing by others intact (story 3).
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown = LOCAL_ORIGIN): void {
  const cur = ytext.toString();
  if (cur === next) return;
  let start = 0;
  const minLen = Math.min(cur.length, next.length);
  while (start < minLen && cur[start] === next[start]) start++;
  let endCur = cur.length;
  let endNext = next.length;
  while (endCur > start && endNext > start && cur[endCur - 1] === next[endNext - 1]) {
    endCur--;
    endNext--;
  }
  const doc = ytext.doc;
  if (doc) {
    doc.transact(
      () => {
        ytext.delete(start, endCur - start);
        if (endNext > start) ytext.insert(start, next.slice(start, endNext));
      },
      origin,
    );
  } else {
    ytext.delete(start, endCur - start);
    if (endNext > start) ytext.insert(start, next.slice(start, endNext));
  }
}

/** Character counter is visible when at most the threshold remains. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at
 * which the element's content fits in `box` px of height; `overflow` when
 * even the minimum does not fit.
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
