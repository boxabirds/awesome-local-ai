import type * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { clampToLimit as _clampToLimit, applyTextDiff as _applyTextDiff } from '../../shared/text-edit';

/**
 * Clamp a string to at most `max` characters (default STICKY_TEXT_MAX_CHARS).
 * Re-exported from shared/text-edit for backward compatibility.
 */
export function clampToLimit(
  next: string,
  max: number = STICKY_TEXT_MAX_CHARS,
): string {
  return _clampToLimit(next, max);
}

/**
 * Apply a minimal diff between the current Y.Text content and `next`.
 * Re-exported from shared/text-edit for backward compatibility.
 */
export function applyTextDiff(
  ytext: Y.Text,
  next: string,
  origin: unknown,
): void {
  _applyTextDiff(ytext, next, origin);
}

/**
 * Returns true when the character counter should be visible,
 * i.e. when remaining characters <= STICKY_COUNTER_THRESHOLD_CHARS.
 */
export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length;
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Binary search for the largest font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * at which the element's content fits within `box` height.
 * Returns the chosen font size and whether there is overflow.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  // Try max first
  el.style.fontSize = `${STICKY_FONT_MAX_PX}px`;
  if (el.scrollHeight <= box) {
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }

  // Try min
  el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
  if (el.scrollHeight > box) {
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }

  // Binary search between min and max
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  // lo is the largest that fits
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}
