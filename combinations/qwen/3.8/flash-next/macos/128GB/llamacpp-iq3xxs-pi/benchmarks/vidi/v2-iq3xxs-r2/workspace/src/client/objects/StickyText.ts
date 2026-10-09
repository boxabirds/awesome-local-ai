import * as Y from 'yjs';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/**
 * Pure text logic behind a sticky note's editor: the 1,000 character limit, the minimal
 * diff written into the shared `Y.Text`, the character counter and the font auto-fit.
 * Kept separate from the component so the rules are unit-testable.
 */

/**
 * Keep at most `max` characters. Typing or pasting never grows a note past the limit:
 * the characters beyond the 1,000th are simply dropped.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  const limit = Number.isFinite(max) && max >= 0 ? Math.floor(max) : STICKY_TEXT_MAX_CHARS;
  if (next.length <= limit) return next;
  return next.slice(0, limit);
}

/** True when the remaining characters are few enough that the counter should show. */
export function counterVisible(length: number): boolean {
  if (!Number.isFinite(length)) return false;
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

const HIGH_SURROGATE_FIRST = 0xd800;
const HIGH_SURROGATE_LAST = 0xdbff;
const LOW_SURROGATE_FIRST = 0xdc00;
const LOW_SURROGATE_LAST = 0xdfff;

function isHighSurrogate(code: number): boolean {
  return code >= HIGH_SURROGATE_FIRST && code <= HIGH_SURROGATE_LAST;
}

function isLowSurrogate(code: number): boolean {
  return code >= LOW_SURROGATE_FIRST && code <= LOW_SURROGATE_LAST;
}

/**
 * The minimal edit between `current` and `next`: the common prefix and suffix are kept,
 * and both cut points are moved out of any UTF-16 surrogate pair so an emoji is never
 * split (which would corrupt what other people see once story 3 syncs).
 */
export function minimalEdit(
  current: string,
  next: string,
): { start: number; deleteLength: number; insertText: string } {
  const a = current;
  const b = next;
  const shorter = Math.min(a.length, b.length);

  let start = 0;
  while (start < shorter && a.charCodeAt(start) === b.charCodeAt(start)) start += 1;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA -= 1;
    endB -= 1;
  }

  // Never cut inside a surrogate pair: shrink the common prefix, then shrink the common
  // suffix by one code unit at a time (at most once per side for a valid pair).
  if (start > 0 && isHighSurrogate(b.charCodeAt(start - 1))) start -= 1;
  if (endB < b.length && isLowSurrogate(b.charCodeAt(endB))) {
    endA += 1;
    endB += 1;
  }

  return { start, deleteLength: Math.max(0, endA - start), insertText: b.slice(start, endB) };
}

/**
 * Write `next` into `ytext` with the smallest possible change (one delete and/or one
 * insert, inside one transaction), so concurrent typing by another person (story 3) is
 * never destroyed. A value that already matches writes nothing, so no update is emitted.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  const { start, deleteLength, insertText } = minimalEdit(current, next);
  if (deleteLength === 0 && insertText.length === 0) return;
  const apply = (): void => {
    if (deleteLength > 0) ytext.delete(start, deleteLength);
    if (insertText.length > 0) ytext.insert(start, insertText);
  };
  const doc = ytext.doc ?? ytext.parent;
  if (doc instanceof Y.Doc) doc.transact(apply, origin);
  else apply();
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at which the
 * element's content still fits in `box` (board units, measured with `scrollHeight`,
 * which is unaffected by the world layer's zoom transform). The size is left applied to
 * the element. `overflow` is true when even the smallest size does not fit, in which
 * case the caller clips the content and fades the bottom edge.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  if (!Number.isFinite(box) || box <= 0) {
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }
  const fitsAt = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };
  if (!fitsAt(STICKY_FONT_MIN_PX)) {
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }
  if (fitsAt(STICKY_FONT_MAX_PX)) {
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }
  // Largest size that still fits: binary search over the integers in range.
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fitsAt(mid)) lo = mid;
    else hi = mid;
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}
