// Pure text logic for sticky notes: minimal Y.Text diffs, the length limit, the counter rule and font fitting.
import type * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** First `n` code units of `s`, stepping back one if that would split a surrogate pair. */
function safeSlice(s: string, n: number): string {
  if (n <= 0) return '';
  if (n >= s.length) return s;
  return isHighSurrogate(s.charCodeAt(n - 1)) ? s.slice(0, n - 1) : s.slice(0, n);
}

/**
 * Lengths of the common prefix and suffix of `a` and `b`, never splitting a surrogate pair,
 * and never overlapping (prefix + suffix <= the shorter length).
 */
function commonEnds(a: string, b: string): { prefix: number; suffix: number } {
  const min = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < min && a.charCodeAt(prefix) === b.charCodeAt(prefix)) prefix++;
  if (prefix > 0 && prefix < min && isHighSurrogate(a.charCodeAt(prefix - 1))) prefix--;
  let suffix = 0;
  while (suffix < min - prefix && a.charCodeAt(a.length - 1 - suffix) === b.charCodeAt(b.length - 1 - suffix)) suffix++;
  if (suffix > 0 && isLowSurrogate(a.charCodeAt(a.length - suffix))) suffix--;
  return { prefix, suffix };
}

/** `next` cut to at most `max` characters (UTF-16 code units), without splitting an emoji. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length <= max ? next : safeSlice(next, max);
}

/**
 * Applies the length limit to an edit from `prev` to `next`: only the newly inserted characters are cut,
 * so typing into a full note drops what was typed rather than the end of the note.
 * `caret` is where the caret belongs when the value was cut, otherwise null.
 */
export function limitEdit(
  prev: string,
  next: string,
  max: number = STICKY_TEXT_MAX_CHARS,
): { value: string; caret: number | null } {
  if (next.length <= max) return { value: next, caret: null };
  const { prefix, suffix } = commonEnds(prev, next);
  const room = max - prefix - suffix;
  if (room < 0) {
    const value = clampToLimit(next, max);
    return { value, caret: value.length };
  }
  const inserted = safeSlice(next.slice(prefix, next.length - suffix), room);
  return {
    value: next.slice(0, prefix) + inserted + next.slice(next.length - suffix),
    caret: prefix + inserted.length,
  };
}

/**
 * Turns `ytext` into `next` with at most one delete and one insert (common prefix and suffix kept),
 * in one transaction. A full replace would wipe out other people's concurrent typing once edits are shared.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const prev = ytext.toString();
  if (prev === next) return;
  const { prefix, suffix } = commonEnds(prev, next);
  const deleteCount = prev.length - prefix - suffix;
  const insert = next.slice(prefix, next.length - suffix);
  const apply = () => {
    if (deleteCount > 0) ytext.delete(prefix, deleteCount);
    if (insert.length > 0) ytext.insert(prefix, insert);
  };
  if (ytext.doc) ytext.doc.transact(apply, origin);
  else apply();
}

/** The counter shows once the remaining characters drop to STICKY_COUNTER_THRESHOLD_CHARS. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at which `el`'s content fits
 * in `box` px of height (`scrollHeight <= box`). Leaves `el` at that size. `overflow` is true when even
 * the minimum size does not fit.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const fits = (px: number) => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };
  if (fits(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  if (!fits(STICKY_FONT_MIN_PX)) return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  let lo = STICKY_FONT_MIN_PX; // fits
  let hi = STICKY_FONT_MAX_PX; // does not fit
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}

/**
 * Where caret position `index` ends up after a remote Y.Text change described by `delta`, so other
 * people's typing does not move my caret relative to my own text. Text inserted exactly at the caret
 * goes after it.
 */
export function transformIndex(delta: ReadonlyArray<{ insert?: unknown; retain?: number; delete?: number }>, index: number): number {
  let pos = 0; // position in the old text
  let result = index;
  for (const op of delta) {
    if (pos > index) break;
    if (op.retain !== undefined) {
      pos += op.retain;
    } else if (op.insert !== undefined) {
      const len = typeof op.insert === 'string' ? op.insert.length : 1;
      if (pos < index) result += len;
    } else if (op.delete !== undefined) {
      const removed = Math.min(op.delete, Math.max(0, index - pos));
      result -= removed;
      pos += op.delete;
    }
  }
  return result;
}
