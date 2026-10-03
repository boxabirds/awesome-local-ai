/**
 * Sticky note text logic (design anchor `sticky.text`), split from the React
 * component so the rules that decide what ends up in the shared document are
 * testable on their own:
 *
 * - `clampToLimit`   — the 1,000 character limit (sticky.text_limit)
 * - `applyTextDiff`  — the minimal change into the shared `Y.Text`
 * - `counterVisible` — when the "n/1000" counter appears
 * - `fitFontSize`    — the auto-fit search (sticky.text_fit)
 *
 * No DOM access beyond the one element `fitFontSize` measures, and no React.
 */

import * as Y from 'yjs';

import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config.js';

/** The character count the counter starts warning about. */
export const COUNTER_REMAINING_THRESHOLD = STICKY_COUNTER_THRESHOLD_CHARS;

/** A high surrogate (first half of an emoji) at `index`? */
const isHighSurrogate = (value: string, index: number): boolean => {
  const code = value.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff;
};

/** A low surrogate (second half of an emoji) at `index`? */
const isLowSurrogate = (value: string, index: number): boolean => {
  const code = value.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff;
};

/**
 * Keep at most `max` characters. Characters beyond the limit are dropped, and a
 * cut that would land in the middle of an emoji (between a high and a low
 * surrogate) is moved back so no lone surrogate is ever stored.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  const limit = Number.isFinite(max) && max >= 0 ? Math.floor(max) : 0;
  if (next.length <= limit) return next;
  // Cutting at `limit` must not split a surrogate pair: if the character just
  // before the cut is half an emoji, cut one earlier instead.
  let cut = limit;
  if (isHighSurrogate(next, cut - 1) && isLowSurrogate(next, cut)) cut -= 1;
  return next.slice(0, cut);
}

/**
 * Write the difference between the shared text and `next` into the shared text
 * as a minimal change: the common prefix and the common suffix are left alone,
 * so only what actually changed is replaced - one delete and/or one insert, in
 * one transaction with `origin`.
 *
 * The diff is computed over *characters* (`Array.from`), so an emoji is one
 * unit to be inserted or deleted and never cut in half; the indices handed to
 * Yjs are UTF-16 code-unit offsets, which is what Y.Text expects.
 *
 * A full replace would destroy text typed concurrently by somebody else
 * (story 3), which is why this is a diff.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  const before = Array.from(current);
  const after = Array.from(next);

  // Longest common prefix, then longest common suffix of what is left.
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  // Character counts -> UTF-16 code-unit offsets for the Yjs operations.
  const prefixUnits = before.slice(0, prefix).join('').length;
  const deleteUnits = before.slice(prefix, before.length - suffix).join('').length;
  const insert = after.slice(prefix, after.length - suffix).join('');

  const apply = () => {
    if (deleteUnits > 0) ytext.delete(prefixUnits, deleteUnits);
    if (insert.length > 0) ytext.insert(prefixUnits, insert);
  };

  const doc = ytext.doc;
  if (doc) doc.transact(apply, origin);
  else apply();
}

/**
 * Does a note of `length` characters have at most
 * `STICKY_COUNTER_THRESHOLD_CHARS` characters left? The counter appears only
 * near the limit ("within 50 characters of the 1,000 character limit").
 */
export function counterVisible(length: number): boolean {
  if (!Number.isFinite(length)) return false;
  return STICKY_TEXT_MAX_CHARS - Math.max(0, length) <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/** Style properties that must match between the measured element and the text. */
const FONT_STEP_PX = 1;

/**
 * The largest integer font size, in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX],
 * at which the element's content fits in `box` pixels of height (measured with
 * `scrollHeight`, so it works for a wrapped block and for a textarea).
 *
 * When even the smallest size does not fit, `overflow` is true: the text keeps
 * the smallest size and the note hides the overflow behind a fade, so nothing
 * is drawn outside the note (sticky.text_fit).
 *
 * The font size is in board units: the note is inside the scaled world layer,
 * so it grows and shrinks with the board zoom and the fit never has to be
 * recomputed for a zoom change.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  const available = Number.isFinite(box) && box > 0 ? box : 0;
  const fitsAt = (fontPx: number): boolean => {
    el.style.fontSize = `${fontPx}px`;
    return el.scrollHeight <= available;
  };

  if (fitsAt(STICKY_FONT_MAX_PX)) {
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }
  if (!fitsAt(STICKY_FONT_MIN_PX)) {
    // Text does not fit at the readable minimum: keep the minimum and report
    // the overflow so the note can fade its bottom edge.
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }

  // The smallest size fits and the largest does not: binary search the largest
  // size that still fits. The range is 15 integers, so at most 4 measurements.
  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  while (high - low > FONT_STEP_PX) {
    const middle = Math.floor((low + high) / 2);
    if (fitsAt(middle)) low = middle;
    else high = middle - 1;
  }
  const fontPx = fitsAt(high) ? high : low;
  return { fontPx, overflow: false };
}
