import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS
} from '../../shared/config';

export type EndEditNext = 'selected' | 'unselected';

export function clampToLimit(next: string, max = STICKY_TEXT_MAX_CHARS): string {
  return next.length <= max ? next : next.slice(0, max);
}

// Minimal change via common prefix + common suffix so concurrent typing by
// other users (story 3) is never destroyed. Surrogate pairs stay intact:
// every unmatched region is deleted and re-inserted whole.
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  let prefix = 0;
  const maxPrefix = Math.min(current.length, next.length);
  while (prefix < maxPrefix && current.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix += 1;
  }
  let suffix = 0;
  const maxSuffix = Math.min(current.length, next.length) - prefix;
  while (
    suffix < maxSuffix &&
    current.charCodeAt(current.length - suffix - 1) === next.charCodeAt(next.length - suffix - 1)
  ) {
    suffix += 1;
  }
  // Yjs stores text as UTF-8, so a diff boundary must never split a
  // surrogate pair: pull the boundary back to a code-point edge. The prefix
  // and suffix regions are identical in both strings by construction, so
  // checking `current` covers `next` too.
  while (splitsSurrogatePair(current, prefix)) prefix -= 1;
  while (splitsSurrogatePair(current, current.length - suffix)) suffix -= 1;

  const deleted = current.length - prefix - suffix;
  const inserted = next.slice(prefix, next.length - suffix);

  ytext.doc?.transact(() => {
    if (deleted > 0) ytext.delete(prefix, deleted);
    if (inserted.length > 0) ytext.insert(prefix, inserted);
  }, origin);
}

function splitsSurrogatePair(s: string, index: number): boolean {
  if (index <= 0 || index >= s.length) return false;
  const before = s.charCodeAt(index - 1);
  const after = s.charCodeAt(index);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

// Largest integer font size in [MIN, MAX] at which the element's content
// still fits vertically inside `box` (board units). Measured at 100% zoom;
// the world transform scales the font uniformly with zoom.
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const fits = (fontPx: number): boolean => {
    el.style.fontSize = `${fontPx}px`;
    return el.scrollHeight <= box;
  };
  if (fits(STICKY_FONT_MAX_PX)) {
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }
  if (!fits(STICKY_FONT_MIN_PX)) {
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { fontPx: lo, overflow: false };
}
