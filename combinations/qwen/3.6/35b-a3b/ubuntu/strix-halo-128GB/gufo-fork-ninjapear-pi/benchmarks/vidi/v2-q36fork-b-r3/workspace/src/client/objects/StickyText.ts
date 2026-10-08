import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX } from '@shared/config';

/**
 * Clamp a string to at most `max` characters (default 1000).
 */
export function clampToLimit(next: string, max = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  return next.slice(0, max);
}

/**
 * Compute whether the counter should be visible.
 * Shows when remaining characters ≤ threshold, i.e., current length ≥ (max - threshold).
 */
export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length;
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Apply a minimal diff between current Y.Text content and the desired `next` string.
 * Computes common prefix and suffix, then performs one delete and one insert inside
 * a single Yjs transaction. This preserves concurrent edits from story 3.
 */
export function applyTextDiff(
  ytext: Y.Text,
  next: string,
  _origin: unknown,
): void {
  const current = ytext.toString();

  // Find common prefix length
  let prefixLen = 0;
  const minLen = Math.min(current.length, next.length);
  while (prefixLen < minLen && current[prefixLen] === next[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix length (after the prefix)
  let suffixLen = 0;
  while (
    suffixLen < current.length - prefixLen &&
    suffixLen < next.length - prefixLen &&
    current[current.length - 1 - suffixLen] === next[next.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const deleteCount = current.length - prefixLen - suffixLen;
  const insertStr = next.slice(prefixLen, next.length - suffixLen);

  if (deleteCount > 0 || insertStr.length > 0) {
    ytext.delete(prefixLen, deleteCount);
    if (insertStr.length > 0) {
      ytext.insert(prefixLen, insertStr);
    }
  }
}

/**
 * Binary-search the largest font size in [minPx, maxPx] where scrollHeight fits
 * within `box` px. Returns the pixel size and an overflow flag.
 * Runs on text change and mount only (zoom scales uniformly).
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let bestFit = lo;

  while (lo <= hi) {
    const mid = Math.round((lo + hi) / 2);
    el.style.fontSize = `${mid}px`;
    const fits = el.scrollHeight <= box;
    if (fits) {
      bestFit = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  el.style.fontSize = `${bestFit}px`;

  // Check overflow at bestFit
  const overflow = el.scrollHeight > box;

  return { fontPx: bestFit, overflow };
}
