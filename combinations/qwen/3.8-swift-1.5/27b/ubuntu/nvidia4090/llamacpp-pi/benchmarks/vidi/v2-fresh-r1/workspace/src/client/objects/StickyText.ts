// Sticky text logic: clamp, diff, counter, font fit.

import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/** Clamp text to at most `max` characters (default STICKY_TEXT_MAX_CHARS). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  return next.slice(0, max);
}

/**
 * Apply a minimal diff (common prefix + common suffix) to a Y.Text.
 * One delete and/or one insert inside one transaction.
 * Surrogate-pair safe.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  // Find common prefix
  let prefixLen = 0;
  const maxPrefix = Math.min(current.length, next.length);
  while (prefixLen < maxPrefix && current[prefixLen] === next[prefixLen]) {
    prefixLen++;
  }

  // Surrogate-pair safety: don't split a surrogate pair at the prefix boundary
  if (prefixLen > 0) {
    const code = current.charCodeAt(prefixLen - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      prefixLen--;
    }
  }

  // Find common suffix (not overlapping with prefix)
  let suffixLen = 0;
  const maxSuffix = Math.min(current.length, next.length) - prefixLen;
  while (
    suffixLen < maxSuffix &&
    current[current.length - 1 - suffixLen] === next[next.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  // Surrogate-pair safety: don't split a surrogate pair at the suffix boundary
  if (suffixLen > 0) {
    const code = current.charCodeAt(current.length - suffixLen);
    if (code >= 0xdc00 && code <= 0xdfff) {
      suffixLen--;
    }
  }

  const deleteLen = current.length - prefixLen - suffixLen;
  const insertStr = next.slice(prefixLen, next.length - suffixLen);

  if (deleteLen === 0 && insertStr.length === 0) return;

  ytext.doc!.transact(() => {
    if (deleteLen > 0) {
      ytext.delete(prefixLen, deleteLen);
    }
    if (insertStr.length > 0) {
      ytext.insert(prefixLen, insertStr);
    }
  }, origin);
}

/** Returns true when the character counter should be visible. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Binary-search integer font sizes from STICKY_FONT_MAX_PX down to
 * STICKY_FONT_MIN_PX for the largest size at which scrollHeight <= box.
 * Returns the font size and an overflow flag.
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

  // Set to the best size found
  el.style.fontSize = `${best}px`;
  const overflow = el.scrollHeight > box;

  return { fontPx: best, overflow };
}
