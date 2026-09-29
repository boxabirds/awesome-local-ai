import * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '@shared/config';

/** Truncates to at most `max` characters (default STICKY_TEXT_MAX_CHARS), never orphaning half a surrogate pair. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  let cut = next.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (isHighSurrogate(last)) cut = cut.slice(0, cut.length - 1);
  return cut;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** True when index i falls strictly between the halves of a surrogate pair in s. */
function insideSurrogatePair(s: string, i: number): boolean {
  if (i <= 0 || i >= s.length) return false;
  return isHighSurrogate(s.charCodeAt(i - 1)) && isLowSurrogate(s.charCodeAt(i));
}

/**
 * Applies the minimal change (common prefix + common suffix) from ytext's
 * current content to `next` (clamped to the character limit).
 * A full replace would destroy concurrent typing once live sync ships (story 3).
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const target = clampToLimit(next);
  const current = ytext.toString();
  if (current === target) return;

  let prefix = 0;
  const minLen = Math.min(current.length, target.length);
  while (prefix < minLen && current.charCodeAt(prefix) === target.charCodeAt(prefix)) prefix++;

  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    current.charCodeAt(current.length - 1 - suffix) === target.charCodeAt(target.length - 1 - suffix)
  ) {
    suffix++;
  }

  // Never split a surrogate pair at the diff boundaries.
  while (prefix > 0 && (insideSurrogatePair(current, prefix) || insideSurrogatePair(target, prefix))) prefix--;
  while (
    suffix > 0 &&
    (insideSurrogatePair(current, current.length - suffix) || insideSurrogatePair(target, target.length - suffix))
  ) suffix--;

  const deleteCount = current.length - prefix - suffix;
  const insertText = target.slice(prefix, target.length - suffix);

  ytext.doc?.transact(() => {
    if (deleteCount > 0) ytext.delete(prefix, deleteCount);
    if (insertText.length > 0) ytext.insert(prefix, insertText);
  }, origin);
}

/** The counter shows when remaining characters <= STICKY_COUNTER_THRESHOLD_CHARS. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Binary search the largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * whose measured content fits the box. `el` is a measuring element with the text content
 * and box width already applied.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const fits = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
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
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return { fontPx: lo, overflow: false };
}
