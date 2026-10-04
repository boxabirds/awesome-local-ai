/**
 * Shared text editing helpers (story 9). Moved from src/client/objects/StickyText.ts
 * so both sticky notes and text objects can share them.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from './board-model';

/**
 * Clamp a string to the maximum character limit.
 */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  return next.slice(0, max);
}

/**
 * Apply a minimal diff (common prefix + common suffix) from the current Y.Text
 * content to the next string. Uses one delete and/or one insert in a single
 * LOCAL_ORIGIN transaction. Surrogate-pair safe.
 */
export function applyTextDiff(ytext: Y.Text, next: string, _origin?: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  const doc = ytext.doc;
  if (!doc) return;

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

  // The middle parts
  const deleteStart = prefixLen;
  const deleteLen = current.length - prefixLen - suffixLen;
  const insertStr = next.slice(prefixLen, next.length - suffixLen);

  doc.transact(
    () => {
      if (deleteLen > 0) {
        ytext.delete(deleteStart, deleteLen);
      }
      if (insertStr.length > 0) {
        ytext.insert(deleteStart, insertStr);
      }
    },
    LOCAL_ORIGIN,
  );
}
