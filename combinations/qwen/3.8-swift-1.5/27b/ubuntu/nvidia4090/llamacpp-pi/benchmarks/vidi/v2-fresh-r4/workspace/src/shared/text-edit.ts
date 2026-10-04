/**
 * Shared text-edit helpers (story 9): character-limit clamping and minimal
 * Y.Text diffs. Used by both sticky notes (story 2) and text objects (story 9).
 */
import * as Y from 'yjs';

/**
 * Clamp a string to at most `max` characters.
 */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  return next.slice(0, max);
}

/**
 * Apply a minimal diff (common prefix + common suffix) from the current
 * Y.Text content to `next`, in one transaction.
 * Surrogate-pair safe.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
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

  // One transaction with the caller's origin so the whole diff is atomic and
  // (with LOCAL_ORIGIN) captured in this tab's undo history (story 8).
  ytext.doc!.transact(() => {
    if (deleteLen > 0) {
      ytext.delete(deleteStart, deleteLen);
    }
    if (insertStr.length > 0) {
      ytext.insert(deleteStart, insertStr);
    }
  }, origin);
}
