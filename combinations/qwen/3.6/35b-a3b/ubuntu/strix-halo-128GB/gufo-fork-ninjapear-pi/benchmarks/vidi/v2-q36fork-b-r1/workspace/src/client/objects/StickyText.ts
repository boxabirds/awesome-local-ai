import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX } from '@/shared/config';

/**
 * Clamp a string to at most max characters.
 */
export function clampToLimit(next: string, max = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) {
    return next;
  }
  return next.slice(0, max);
}

/**
 * Apply a minimal diff between current Y.Text content and the next string.
 * Uses common prefix + common suffix strategy so concurrent typing is not destroyed.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) {
    return;
  }

  // Find common prefix length
  let prefixLen = 0;
  const minLen = Math.min(current.length, next.length);
  while (prefixLen < minLen && current[prefixLen] === next[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix length (from end)
  let suffixLen = 0;
  const remainingCurrent = current.length - prefixLen;
  const remainingNext = next.length - prefixLen;
  while (
    suffixLen < remainingCurrent &&
    suffixLen < remainingNext &&
    current[current.length - 1 - suffixLen] === next[next.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const deleteLen = remainingCurrent - suffixLen;
  const insertStr = next.slice(prefixLen, next.length - suffixLen);

  ytext.delete(prefixLen, deleteLen);
  if (insertStr) {
    ytext.insert(prefixLen, insertStr);
  }
}

/**
 * Determine if the character counter should be shown.
 * Shows when remaining chars <= threshold.
 */
export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length;
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS && remaining >= 0;
}

/**
 * Binary search for the largest font size in [minPx, maxPx] where
 * scrollHeight fits within boxWidth × boxHeight.
 * @returns { fontPx, overflow } — whether text overflows at the minimum size.
 */
export function fitFontSize(
  el: HTMLElement,
  boxSize: number,
): { fontPx: number; overflow: boolean } {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;

  while (lo <= hi) {
    const mid = Math.round((lo + hi) / 2);
    el.style.fontSize = `${mid}px`;
    el.style.padding = '8px';

    if (el.scrollHeight <= boxSize) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return {
    fontPx: best,
    overflow: best === STICKY_FONT_MIN_PX && el.scrollHeight > boxSize,
  };
}
