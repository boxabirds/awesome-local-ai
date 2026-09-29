import * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '@shared/config';
import { clampToLimit as clampToLimitShared, applyTextDiff as applyTextDiffShared } from '@shared/text-edit';

/**
 * Truncates to at most `max` characters (default STICKY_TEXT_MAX_CHARS), never orphaning
 * half a surrogate pair. Thin wrapper over the shared helper so story 2 callers and
 * tests are unchanged.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToLimitShared(next, max);
}

/**
 * Applies the minimal change from ytext's current content to `next` (clamped to the
 * character limit). Thin wrapper over the shared helper that defaults to the sticky
 * limit so story 2 callers and tests are unchanged.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown, max: number = STICKY_TEXT_MAX_CHARS): void {
  applyTextDiffShared(ytext, next, origin, max);
}

/** Convenience: apply diff with sticky's max chars. */
export function applyStickyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  applyTextDiffShared(ytext, next, origin, STICKY_TEXT_MAX_CHARS);
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
