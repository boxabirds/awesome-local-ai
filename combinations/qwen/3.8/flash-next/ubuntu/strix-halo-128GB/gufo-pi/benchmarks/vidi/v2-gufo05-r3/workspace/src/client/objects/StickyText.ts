import type * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { clampToLimit as clampGeneric, applyTextDiff as diffGeneric } from '../../shared/text-edit';

/**
 * Sticky note text logic.
 *
 * Everything here is measurement- or Yjs-level and free of React so it can be
 * unit tested: the character limit, the *minimal* diff written into the shared
 * `Y.Text` (a full replace would destroy other people's typing once story 3
 * syncs), the counter visibility rule, and the font auto-fit search.
 */

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function boundarySafe(value: string, i: number): boolean {
  if (i <= 0 || i >= value.length) return true;
  return !(isHighSurrogate(value.charCodeAt(i - 1)) && isLowSurrogate(value.charCodeAt(i)));
}

// Re-export from the shared module with sticky-specific default limit.
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampGeneric(next, max);
}

export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  diffGeneric(ytext, next, origin);
}

/**
 * True when the remaining character budget is within
 * STICKY_COUNTER_THRESHOLD_CHARS, i.e. the counter is worth showing.
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size (in board units) at which the element's content
 * still fits in `box`, searched by bisection between STICKY_FONT_MIN_PX and
 * STICKY_FONT_MAX_PX. The size is left applied to `el`.
 *
 * `overflow` is true when even the smallest size does not fit: the caller then
 * clips the text inside the note and shows the bottom fade.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  const fits = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };

  if (!fits(STICKY_FONT_MIN_PX)) {
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }
  if (fits(STICKY_FONT_MAX_PX)) {
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }
  let lo = STICKY_FONT_MIN_PX; // fits
  let hi = STICKY_FONT_MAX_PX; // does not fit
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  fits(lo);
  return { fontPx: lo, overflow: false };
}

/** Common prefix/suffix edit between two strings, in UTF-16 units. */
function affixInUnits(prev: string, next: string): {
  prefix: number;
  deleteCount: number;
  insert: string;
} {
  const maxPrefix = Math.min(prev.length, next.length);
  let prefix = 0;
  while (prefix < maxPrefix && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix += 1;
  }
  // Boundaries must never cut a surrogate pair in half.
  while (prefix > 0 && (!boundarySafe(prev, prefix) || !boundarySafe(next, prefix))) {
    prefix -= 1;
  }

  let suffix = 0;
  let maxSuffix = Math.min(prev.length - prefix, next.length - prefix);
  while (
    suffix < maxSuffix &&
    prev.charCodeAt(prev.length - suffix - 1) === next.charCodeAt(next.length - suffix - 1)
  ) {
    suffix += 1;
  }
  maxSuffix = Math.min(prev.length - prefix, next.length - prefix);
  if (suffix > maxSuffix) suffix = maxSuffix;
  while (
    suffix > 0 &&
    (!boundarySafe(prev, prev.length - suffix) || !boundarySafe(next, next.length - suffix))
  ) {
    suffix -= 1;
  }
  return {
    prefix,
    deleteCount: prev.length - prefix - suffix,
    insert: next.slice(prefix, next.length - suffix),
  };
}

/**
 * Move a caret position from `prev` text to `next` text.
 *
 * `next` is usually the same text as `prev` plus somebody else's edit, which is
 * expressed as the minimal common-affix change (retain, delete, insert). A caret
 * before that change stays put, a caret after it shifts by the net length
 * change, and a caret inside it lands after the inserted text. Used to keep the
 * local caret sensible while another person types in the same note.
 */
export function mapCaret(prev: string, next: string, pos: number): number {
  const clamped = Math.min(Math.max(pos, 0), prev.length);
  if (prev === next) return Math.min(clamped, next.length);
  const { prefix, deleteCount, insert } = affixInUnits(prev, next);
  const changeEnd = prefix + deleteCount;
  if (clamped <= prefix) return clamped;
  if (clamped >= changeEnd) return Math.min(next.length, clamped - deleteCount + insert.length);
  return Math.min(next.length, prefix + insert.length);
}
