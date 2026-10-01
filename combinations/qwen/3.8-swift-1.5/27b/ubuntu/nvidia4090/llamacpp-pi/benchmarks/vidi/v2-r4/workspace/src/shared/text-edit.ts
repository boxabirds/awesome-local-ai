import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from './board-model';

/**
 * Shared text-editing helpers for objects with a Y.Text payload
 * (sticky notes, story 2; free text, story 9).
 */

/** Truncates `next` to at most `max` characters (text.limit). */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  return next.slice(0, max);
}

/**
 * Applies a minimal diff (common prefix + common suffix) to a Y.Text.
 * This is surrogate-pair safe because we work with the string directly
 * and Y.Text handles the Unicode internally.
 */
export function applyTextDiff(ytext: Y.Text, next: string, _origin?: unknown): void {
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

  const deleteStart = prefixLen;
  const deleteEnd = current.length - suffixLen;
  const insertStr = next.slice(prefixLen, next.length - suffixLen);

  // One tracked transaction per keystroke so per-user undo (story 8) sees
  // these edits as local changes with LOCAL_ORIGIN.
  const apply = () => {
    ytext.delete(deleteStart, deleteEnd - deleteStart);
    if (insertStr.length > 0) {
      ytext.insert(deleteStart, insertStr);
    }
  };
  const ydoc = ytext.doc;
  if (ydoc == null) {
    apply(); // detached type: no doc to transact on (not reachable in the app)
  } else {
    ydoc.transact(apply, LOCAL_ORIGIN);
  }
}
