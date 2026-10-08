import { STICKY_TEXT_MAX_CHARS } from './config';

/**
 * Clamp a string to at most `max` characters.
 */
export function clampToLimit(next: string, max = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  return next.slice(0, max);
}

/**
 * Apply a minimal diff between current Y.Text content and the desired `next` string.
 * Computes common prefix and suffix, then performs one delete and one insert inside
 * a single Yjs transaction. This preserves concurrent edits.
 */
export function applyTextDiff(
  ytext: import('yjs').Text,
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
