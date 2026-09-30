/**
 * Story 9: shared Y.Text editing helpers.
 *
 * `clampToLimit` and `applyTextDiff` were moved here from
 * `src/client/objects/StickyText.ts` (story 2) so sticky notes and free
 * text share the same minimal-diff logic. `StickyText.ts` re-exports them.
 */
import * as Y from 'yjs';

/** Truncate `next` to at most `max` characters (PRD text.limit). */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  return next.slice(0, max);
}

/**
 * Apply the minimal diff between the Y.Text's current content and `next`
 * (common prefix/suffix), in one transaction with `origin`.
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

  // Find common suffix (not overlapping with prefix)
  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    current[current.length - 1 - suffixLen] === next[next.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const deleteLen = current.length - prefixLen - suffixLen;
  const insertStr = next.slice(prefixLen, next.length - suffixLen);

  const doc = (ytext as { doc?: Y.Doc }).doc;
  if (doc) {
    doc.transact(() => {
      if (deleteLen > 0) {
        ytext.delete(prefixLen, deleteLen);
      }
      if (insertStr.length > 0) {
        ytext.insert(prefixLen, insertStr);
      }
    }, origin);
  } else {
    if (deleteLen > 0) {
      ytext.delete(prefixLen, deleteLen);
    }
    if (insertStr.length > 0) {
      ytext.insert(prefixLen, insertStr);
    }
  }
}
