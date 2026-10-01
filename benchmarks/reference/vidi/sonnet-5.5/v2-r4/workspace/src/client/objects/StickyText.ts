import type * as Y from 'yjs';
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_TEXT_MAX_CHARS } from '../../shared/config';

function isHigh(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
function isLow(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Keeps at most `max` UTF-16 units without cutting a surrogate pair in half. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  let end = max;
  if (end > 0 && isHigh(next.charCodeAt(end - 1))) end -= 1;
  return next.slice(0, end);
}

/** Applies the smallest single delete and/or insert that turns the Y.Text into `next`. */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const prev = ytext.toString();
  if (prev === next) return;
  const max = Math.min(prev.length, next.length);
  let prefix = 0;
  while (prefix < max && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;
  if (prefix > 0 && isHigh(prev.charCodeAt(prefix - 1))) prefix--;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  )
    suffix++;
  if (suffix > 0 && isLow(prev.charCodeAt(prev.length - suffix))) suffix--;
  const removeCount = prev.length - prefix - suffix;
  const insert = next.slice(prefix, next.length - suffix);
  const apply = () => {
    if (removeCount > 0) ytext.delete(prefix, removeCount);
    if (insert.length > 0) ytext.insert(prefix, insert);
  };
  if (ytext.doc) ytext.doc.transact(apply, origin);
  else apply();
}

export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Finds the largest integer font size in [MIN, MAX] at which the element's content height fits `box`.
 * `el` must size to its content (so scrollHeight is the natural text height).
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const fits = (px: number) => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  if (!fits(lo)) return { fontPx: lo, overflow: true };
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}
