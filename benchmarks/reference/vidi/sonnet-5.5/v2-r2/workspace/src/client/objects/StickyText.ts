import type * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** Keeps at most `max` UTF-16 units, never cutting a surrogate pair in half. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  let end = max;
  if (end > 0 && isHighSurrogate(next.charCodeAt(end - 1))) end -= 1;
  return next.slice(0, end);
}

/** Writes the smallest insert/delete that turns the current text into `next`. */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const prev = ytext.toString();
  if (prev === next) return;
  let prefix = 0;
  const maxPrefix = Math.min(prev.length, next.length);
  while (prefix < maxPrefix && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1;
  if (prefix > 0 && isHighSurrogate(prev.charCodeAt(prefix - 1))) prefix -= 1;
  let suffix = 0;
  const maxSuffix = Math.min(prev.length, next.length) - prefix;
  while (
    suffix < maxSuffix
    && prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) suffix += 1;
  if (suffix > 0 && isLowSurrogate(prev.charCodeAt(prev.length - suffix))) suffix -= 1;
  const removed = prev.length - prefix - suffix;
  const inserted = next.slice(prefix, next.length - suffix);
  const run = () => {
    if (removed > 0) ytext.delete(prefix, removed);
    if (inserted.length > 0) ytext.insert(prefix, inserted);
  };
  if (ytext.doc) ytext.doc.transact(run, origin);
  else run();
}

export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Finds the largest integer font size in [min, max] at which the content of `el`
 * fits in `box` pixels of height. Leaves the chosen size on `el`.
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
