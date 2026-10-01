// src/client/objects/StickyText.ts
// Pure text logic for sticky notes: clamp, diff, counter, font fit.
// clampToLimit and applyTextDiff are now in src/shared/text-edit.ts (story 9).

import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';

// Re-export shared helpers with sticky-specific defaults so story 2 callers are unchanged.
import { clampToLimit as _clampToLimit, applyTextDiff as _applyTextDiff } from '../../shared/text-edit';

export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return _clampToLimit(next, max);
}

export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length;
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Apply a minimal diff to a Y.Text (story 2 wrapper around shared helper).
 */
export function applyTextDiff(ytext: Y.Text, next: string): void {
  _applyTextDiff(ytext, next, LOCAL_ORIGIN);
}

/**
 * Binary search for the largest integer font size in [min, max]
 * at which the element's scrollHeight fits within the box.
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
