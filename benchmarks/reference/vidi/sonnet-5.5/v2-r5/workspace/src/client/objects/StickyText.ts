import type * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  let end = max;
  if (end > 0 && isHigh(next.charCodeAt(end - 1))) end -= 1; // never split a surrogate pair
  return next.slice(0, end);
}

export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/** Minimal edit: common prefix and suffix are kept, only the middle is deleted/inserted. */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const cur = ytext.toString();
  if (cur === next) return;
  let prefix = 0;
  const maxPrefix = Math.min(cur.length, next.length);
  while (prefix < maxPrefix && cur.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;
  if (prefix > 0 && isHigh(cur.charCodeAt(prefix - 1))) prefix--;
  let suffix = 0;
  const maxSuffix = Math.min(cur.length, next.length) - prefix;
  while (suffix < maxSuffix
    && cur.charCodeAt(cur.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)) suffix++;
  if (suffix > 0 && isLow(cur.charCodeAt(cur.length - suffix))) suffix--;
  const del = cur.length - prefix - suffix;
  const ins = next.slice(prefix, next.length - suffix);
  const run = () => {
    if (del > 0) ytext.delete(prefix, del);
    if (ins.length > 0) ytext.insert(prefix, ins);
  };
  if (ytext.doc) ytext.doc.transact(run, origin);
  else run();
}

/** Largest integer font size in [MIN, MAX] at which el's content fits within `box` px of height. */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const fits = (px: number) => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  if (fits(hi)) return { fontPx: hi, overflow: false };
  if (!fits(lo)) return { fontPx: lo, overflow: true };
  while (hi - lo > 1) { // invariant: lo fits, hi does not
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) lo = mid; else hi = mid;
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}
