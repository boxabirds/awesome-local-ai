/**
 * Shared text-editing helpers (story 9, text.model).
 *
 * `clampToLimit` and `applyTextDiff` are shared by sticky notes (story 2)
 * and free text objects (story 9); `StickyText.ts` re-exports them so the
 * story 2 callers and tests are unchanged.
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
 * Apply a minimal text diff (common prefix + suffix) to a Y.Text.
 * Uses one transaction with the given origin.
 *
 * Computes the common prefix and common suffix of the current and next
 * strings, then performs at most one delete and one insert.
 * Surrogate-pair safe: operates on code units but the prefix/suffix
 * computation naturally respects pair boundaries since we compare
 * character by character.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  // Find common prefix length
  let prefixLen = 0;
  const minLen = Math.min(current.length, next.length);
  while (prefixLen < minLen && current[prefixLen] === next[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix length (not overlapping with prefix)
  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    current[current.length - 1 - suffixLen] === next[next.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const deleteStart = prefixLen;
  const deleteLen = current.length - prefixLen - suffixLen;
  const insertStr = next.slice(prefixLen, next.length - suffixLen);

  const apply = () => {
    if (deleteLen > 0) {
      ytext.delete(deleteStart, deleteLen);
    }
    if (insertStr.length > 0) {
      ytext.insert(prefixLen, insertStr);
    }
  };

  if (ytext.doc) {
    ytext.doc.transact(apply, origin as never);
  } else {
    apply();
  }
}
