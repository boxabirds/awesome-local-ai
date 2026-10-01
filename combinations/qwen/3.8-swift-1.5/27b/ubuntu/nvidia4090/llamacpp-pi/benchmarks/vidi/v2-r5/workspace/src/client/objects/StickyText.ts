// src/client/objects/StickyText.ts
// Pure text logic for sticky notes: clamp, diff, counter, font fit.

import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX } from '../../shared/config';

export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  return next.slice(0, max);
}

export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length;
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Apply a minimal diff to a Y.Text: find common prefix and suffix,
 * then delete the middle of the old and insert the middle of the new.
 * Surrogate-pair safe.
 */
export function applyTextDiff(ytext: Y.Text, next: string, _origin?: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  // Find common prefix
  let prefixLen = 0;
  const maxPrefix = Math.min(current.length, next.length);
  while (prefixLen < maxPrefix && current[prefixLen] === next[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix (not overlapping with prefix)
  let suffixLen = 0;
  const maxSuffix = Math.min(current.length, next.length) - prefixLen;
  while (suffixLen < maxSuffix && current[current.length - 1 - suffixLen] === next[next.length - 1 - suffixLen]) {
    suffixLen++;
  }

  const deleteStart = prefixLen;
  const deleteLen = current.length - prefixLen - suffixLen;
  const insertStr = next.slice(prefixLen, next.length - suffixLen);

  if (deleteLen > 0) {
    ytext.delete(deleteStart, deleteLen);
  }
  if (insertStr.length > 0) {
    ytext.insert(prefixLen, insertStr);
  }
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
