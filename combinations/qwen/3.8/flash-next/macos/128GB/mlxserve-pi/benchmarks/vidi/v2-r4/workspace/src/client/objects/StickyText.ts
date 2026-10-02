/**
 * Pure text logic for sticky notes: the length limit, the minimal Y.Text diff
 * and the auto-fit font search. No React and — apart from the one documented
 * measurement on {@link fitFontSize} — no layout assumptions, so the rules are
 * unit-testable and the note component stays small.
 */
import type * as Y from 'yjs';

import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/** Keeps at most `max` characters (default {@link STICKY_TEXT_MAX_CHARS}). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length > max ? next.slice(0, max) : next;
}

/** True when the character counter should be shown for a text of this length. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** True when `index` falls between the two halves of a surrogate pair. */
function splitsPair(text: string, index: number): boolean {
  return (
    index > 0 &&
    index < text.length &&
    isHighSurrogate(text.charCodeAt(index - 1)) &&
    isLowSurrogate(text.charCodeAt(index))
  );
}

/**
 * Writes `next` into `ytext` with the minimal insert and/or delete, in one
 * transaction carrying `origin`.
 *
 * The common prefix and suffix are kept untouched, so a concurrent edit by
 * another user (story 3) merges on the unchanged parts instead of being
 * overwritten by a full replace. A diff boundary is never allowed to cut a
 * surrogate pair in half, which would leave a lone surrogate behind when the
 * pair is deleted.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  const shorter = Math.min(current.length, next.length);
  let start = 0;
  while (start < shorter && current.charCodeAt(start) === next.charCodeAt(start)) {
    start += 1;
  }
  let endCurrent = current.length;
  let endNext = next.length;
  while (
    endCurrent > start &&
    endNext > start &&
    current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)
  ) {
    endCurrent -= 1;
    endNext -= 1;
  }
  if (splitsPair(current, start) || splitsPair(next, start)) start -= 1;

  const write = () => {
    if (endCurrent > start) ytext.delete(start, endCurrent - start);
    const inserted = next.slice(start, endNext);
    if (inserted.length > 0) ytext.insert(start, inserted);
  };

  const doc = ytext.doc;
  if (doc) doc.transact(write, origin);
  else write();
}

/**
 * Where the caret of an open editor goes when the text it sits in changes from
 * `before` to `after` — the other half of {@link applyTextDiff}, which is what
 * lets somebody else's typing into the same note be shown here.
 *
 * A caret in front of the change does not move; a caret behind it travels by
 * however much the text grew or shrank; a caret inside the changed run goes to
 * the front of it. Nothing ever lands past the end of the text.
 */
export function mapCaret(caret: number, before: string, after: string): number {
  if (before === after) return Math.min(caret, after.length);

  const shorter = Math.min(before.length, after.length);
  let start = 0;
  while (start < shorter && before.charCodeAt(start) === after.charCodeAt(start)) {
    start += 1;
  }
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }

  if (caret <= start) return Math.min(caret, after.length);
  if (caret >= endBefore) return Math.min(caret + (endAfter - endBefore), after.length);
  return start;
}

/**
 * Largest integer font size, in the range `[STICKY_FONT_MIN_PX,
 * STICKY_FONT_MAX_PX]`, at which the element's content fits in `box` pixels.
 *
 * Needs real layout: the caller measures the element that clips the text. When
 * even the smallest size does not fit, `overflow` is true — the caller clips
 * and fades the bottom edge instead of drawing outside the note.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  if (!Number.isFinite(box) || box <= 0) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };

  const fitsAt = (px: number): boolean => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };

  if (fitsAt(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  if (!fitsAt(STICKY_FONT_MIN_PX)) {
    el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }

  // `lo` fits, `hi` does not; narrow to the largest fitting integer.
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
