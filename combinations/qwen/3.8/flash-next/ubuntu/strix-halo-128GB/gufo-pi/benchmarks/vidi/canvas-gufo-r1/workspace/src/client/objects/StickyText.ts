import type * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/**
 * Clamp a string to at most `max` characters (default STICKY_TEXT_MAX_CHARS).
 */
export function clampToLimit(
  next: string,
  max: number = STICKY_TEXT_MAX_CHARS,
): string {
  return next.length <= max ? next : next.slice(0, max);
}

/**
 * Apply a minimal diff between the current Y.Text content and `next`.
 * Uses common prefix + common suffix to produce a single insert and/or delete
 * rather than replacing all content (preserves concurrent edits for story 3).
 */
export function applyTextDiff(
  ytext: Y.Text,
  next: string,
  origin: unknown,
): void {
  const current = ytext.toString();
  if (current === next) return;

  // Find common prefix length
  let prefix = 0;
  const maxPrefix = Math.min(current.length, next.length);
  while (prefix < maxPrefix && current[prefix] === next[prefix]) {
    prefix++;
  }

  // Find common suffix length (after prefix)
  let suffix = 0;
  const maxSuffix = Math.min(current.length - prefix, next.length - prefix);
  while (
    suffix < maxSuffix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }

  // Delete the old middle portion and insert the new middle portion
  const deleteLen = current.length - prefix - suffix;
  const insertStr = next.slice(prefix, next.length - suffix);

  ytext.doc!.transact(() => {
    if (deleteLen > 0) {
      ytext.delete(prefix, deleteLen);
    }
    if (insertStr.length > 0) {
      ytext.insert(prefix, insertStr);
    }
  }, origin);
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
