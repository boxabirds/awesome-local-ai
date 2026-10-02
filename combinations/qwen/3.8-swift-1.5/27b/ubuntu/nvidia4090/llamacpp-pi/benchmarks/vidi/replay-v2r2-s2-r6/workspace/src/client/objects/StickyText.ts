import * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MIN_PX,
  STICKY_FONT_MAX_PX,
} from '../../shared/config';

/** Keeps at most `max` (default STICKY_TEXT_MAX_CHARS) characters. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length <= max ? next : next.slice(0, max);
}

/**
 * Applies the minimal change from the Y.Text's current value to `next`:
 * common prefix + common suffix, so at most one delete and one insert,
 * inside a single transaction. Surrogate-pair safe: the prefix/suffix are
 * found on code units, so a pair is only ever split where the text
 * genuinely changed inside it.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  const lenCurrent = current.length;
  const lenNext = next.length;

  // Common prefix
  let prefix = 0;
  const maxPrefix = Math.min(lenCurrent, lenNext);
  while (prefix < maxPrefix && current[prefix] === next[prefix]) prefix++;

  // Common suffix (not overlapping the prefix)
  let suffix = 0;
  const maxSuffix = Math.min(lenCurrent, lenNext) - prefix;
  while (suffix < maxSuffix && current[lenCurrent - 1 - suffix] === next[lenNext - 1 - suffix]) suffix++;

  // Never let the diff boundaries split a surrogate pair: Y.Text cannot
  // represent unpaired surrogates in its encoding, so a lone-surrogate
  // insert/delete corrupts the text. Pull the whole pair into the change.
  const isHigh = (i: number, s: string) => {
    const c = s.charCodeAt(i);
    return c >= 0xd800 && c <= 0xdbff;
  };
  const isLow = (i: number, s: string) => {
    const c = s.charCodeAt(i);
    return c >= 0xdc00 && c <= 0xdfff;
  };
  if (prefix > 0 && isHigh(prefix - 1, current) && isLow(prefix, current)) prefix--;
  if (suffix > 0 && isHigh(lenCurrent - suffix - 1, current) && isLow(lenCurrent - suffix, current)) suffix--;

  const deleteFrom = prefix;
  const deleteLen = lenCurrent - prefix - suffix;
  const insert = next.slice(prefix, lenNext - suffix);

  const apply = () => {
    if (deleteLen > 0) ytext.delete(deleteFrom, deleteLen);
    if (insert.length > 0) ytext.insert(deleteFrom, insert);
  };

  // One transaction (origin used by story 8 undo / story 3 echo suppression).
  // A Y.Text is always attached to the board doc in production; a detached
  // text (tests) applies the two ops without an explicit transaction.
  const doc = ytext.doc;
  if (doc) {
    doc.transact(apply, origin);
  } else {
    apply();
  }
}

/**
 * True when `length` characters leaves at most STICKY_COUNTER_THRESHOLD_CHARS
 * remaining under the limit (the "n/1000" counter appears).
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Binary-searches integer font sizes from STICKY_FONT_MAX_PX down to
 * STICKY_FONT_MIN_PX (board units at 100% zoom) for the largest size at which
 * `el.scrollHeight <= box`. Sets el's font-size to the chosen size.
 * Returns `overflow` when the text does not fit even at the minimum size.
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
  const overflow = el.scrollHeight > box;
  return { fontPx: best, overflow };
}
