import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_TEXT_MAX_CHARS } from '../../shared/config';

export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length > max ? next.slice(0, max) : next;
}

export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

// Moves an index left so it never sits between the two code units of a
// surrogate pair.
function safeIndex(s: string, i: number): number {
  if (i > 0 && i < s.length && isLowSurrogate(s.charCodeAt(i))) return i - 1;
  return i;
}

export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown = LOCAL_ORIGIN): void {
  const current = ytext.toString();
  if (current === next) return;
  const doc = ytext.doc;
  const apply = (): void => {
    const maxCommon = Math.min(current.length, next.length);
    let start = 0;
    while (start < maxCommon && current[start] === next[start]) start += 1;
    let endCurrent = current.length;
    let endNext = next.length;
    while (endCurrent > start && endNext > start && current[endCurrent - 1] === next[endNext - 1]) {
      endCurrent -= 1;
      endNext -= 1;
    }
    const from = safeIndex(current, safeIndex(next, start));
    const deleteLength = endCurrent - from;
    const inserted = next.slice(from, endNext);
    if (deleteLength > 0) ytext.delete(from, deleteLength);
    if (inserted.length > 0) ytext.insert(from, inserted);
  };
  if (doc !== null) doc.transact(apply, origin);
  else apply();
}

export interface FitResult {
  fontPx: number;
  overflow: boolean;
}

// Binary-searches the largest integer font size (within [MIN, MAX]) at which the
// element's content height fits within `box`. When even the minimum size does
// not fit, `overflow` is true and the caller must clip and show a fade.
export function fitFontSize(el: HTMLElement, box: number): FitResult {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;
  let fits = false;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      best = mid;
      fits = true;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  el.style.fontSize = `${best}px`;
  return { fontPx: best, overflow: !fits };
}
