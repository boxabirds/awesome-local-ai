import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX } from '../../shared/config';

/**
 * Clamp a string to at most `max` characters (default STICKY_TEXT_MAX_CHARS).
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  return next.slice(0, max);
}

/**
 * Whether the character counter should be visible.
 * Shows when remaining characters <= STICKY_COUNTER_THRESHOLD_CHARS.
 */
export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length;
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Apply a minimal diff (common prefix + common suffix) from the current
 * Y.Text content to `next`, in one transaction.
 * Surrogate-pair safe.
 */
export function applyTextDiff(ytext: Y.Text, next: string, _origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  // Find common prefix
  let prefixLen = 0;
  const minLen = Math.min(current.length, next.length);
  while (prefixLen < minLen && current[prefixLen] === next[prefixLen]) {
    prefixLen++;
  }

  // Don't split a surrogate pair at the prefix boundary
  if (
    prefixLen > 0 &&
    prefixLen < current.length &&
    prefixLen < next.length
  ) {
    const prevCode = current.charCodeAt(prefixLen - 1);
    const nextCode = current.charCodeAt(prefixLen);
    if (prevCode >= 0xd800 && prevCode <= 0xdbff && nextCode >= 0xdc00 && nextCode <= 0xdfff) {
      prefixLen--;
    }
  }

  // Find common suffix (not overlapping with prefix)
  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    current[current.length - 1 - suffixLen] === next[next.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  // Don't split a surrogate pair at the suffix boundary
  if (suffixLen > 0) {
    const suffixStart = current.length - suffixLen;
    if (suffixStart > prefixLen) {
      const prevCode = current.charCodeAt(suffixStart - 1);
      const nextCode = current.charCodeAt(suffixStart);
      if (prevCode >= 0xd800 && prevCode <= 0xdbff && nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        suffixLen--;
      }
    }
  }

  // The middle parts that differ
  const deleteStart = prefixLen;
  const deleteLen = current.length - prefixLen - suffixLen;
  const insertStr = next.slice(prefixLen, next.length - suffixLen);

  if (deleteLen > 0) {
    ytext.delete(deleteStart, deleteLen);
  }
  if (insertStr.length > 0) {
    ytext.insert(deleteStart, insertStr);
  }
}

/**
 * Binary-search the largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * at which the element's scrollHeight <= box.
 * Returns { fontPx, overflow }.
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
