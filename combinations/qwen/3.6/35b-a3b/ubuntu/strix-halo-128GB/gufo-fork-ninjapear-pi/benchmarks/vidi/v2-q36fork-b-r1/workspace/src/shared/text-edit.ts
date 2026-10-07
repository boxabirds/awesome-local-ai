import { TEXT_MAX_CHARS } from './config';

/**
 * Clamp a string to at most max characters.
 */
export function clampToLimit(next: string, max = TEXT_MAX_CHARS): string {
  if (next.length <= max) {
    return next;
  }
  return next.slice(0, max);
}

/**
 * Apply a minimal diff between current Y.Text content and the next string.
 * Uses common prefix + common suffix strategy so concurrent typing is not destroyed.
 */
export function applyTextDiff(ytext: any, next: string, origin: unknown): void {
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
