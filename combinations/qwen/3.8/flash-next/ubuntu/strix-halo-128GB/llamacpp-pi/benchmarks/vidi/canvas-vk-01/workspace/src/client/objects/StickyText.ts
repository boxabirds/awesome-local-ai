import * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MIN_PX,
  STICKY_FONT_MAX_PX,
} from '../../shared/config';

/**
 * Sticky text logic: clamp, diff, counter visibility, and font fitting.
 */

/** Clamp a string to at most `max` characters. Surrogate-pair safe. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  // Avoid splitting a surrogate pair at the boundary
  let cut = max;
  if (cut > 0 && next.charCodeAt(cut - 1) >= 0xD800 && next.charCodeAt(cut - 1) <= 0xDBFF) {
    cut -= 1;
  }
  return next.slice(0, cut);
}

/**
 * Apply a minimal diff from `ytext`'s current content to `next`.
 * Uses common prefix + common suffix to produce at most one delete + one insert.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  // Find common prefix length (codepoint-aware)
  let prefix = 0;
  const minLen = Math.min(current.length, next.length);
  while (prefix < minLen && current[prefix] === next[prefix]) {
    prefix++;
  }

  // Find common suffix length (codepoint-aware, not overlapping with prefix)
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }

  const deleteCount = current.length - prefix - suffix;
  const insertText = next.slice(prefix, next.length - suffix);

  if (deleteCount === 0 && insertText.length === 0) return;

  ytext.doc?.transact(() => {
    ytext.delete(prefix, deleteCount);
    if (insertText.length > 0) {
      ytext.insert(prefix, insertText);
    }
  }, origin ?? undefined);
}

/** Returns true when the character counter should be visible (remaining <= threshold). */
export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length;
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Binary-search the largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * such that el.scrollHeight <= box. Returns overflow=true if even the smallest size doesn't fit.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const min = STICKY_FONT_MIN_PX;
  const max = STICKY_FONT_MAX_PX;

  // Try max first
  el.style.fontSize = `${max}px`;
  if (el.scrollHeight <= box) {
    return { fontPx: max, overflow: false };
  }

  // Try min
  el.style.fontSize = `${min}px`;
  if (el.scrollHeight <= box) {
    // Binary search between min and max for the largest fitting size
    let lo = min;
    let hi = max;
    while (lo < hi - 1) {
      const mid = Math.floor((lo + hi) / 2);
      el.style.fontSize = `${mid}px`;
      if (el.scrollHeight <= box) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    el.style.fontSize = `${lo}px`;
    return { fontPx: lo, overflow: false };
  }

  // Even min doesn't fit
  el.style.fontSize = `${min}px`;
  return { fontPx: min, overflow: true };
}
