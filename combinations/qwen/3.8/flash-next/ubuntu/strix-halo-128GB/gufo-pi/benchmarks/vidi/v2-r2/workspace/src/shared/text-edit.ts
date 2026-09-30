/**
 * Shared text-editing helpers used by both sticky notes (story 2) and
 * text objects (story 9). Lives in shared so both can import without
 * pulling in React or client-specific code.
 */

export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  // Be careful not to split a surrogate pair at the boundary
  let end = max;
  if (end > 0) {
    const code = next.charCodeAt(end - 1);
    // High surrogate: if we'd cut right after it, we'd leave a lone high surrogate
    if (code >= 0xd800 && code <= 0xdbff) {
      end--;
    }
  }
  return next.slice(0, end);
}

import type * as Y from 'yjs';

export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  // Find common prefix
  let prefixLen = 0;
  const minLen = Math.min(current.length, next.length);
  while (prefixLen < minLen && current[prefixLen] === next[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix (but not overlapping with prefix)
  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    current[current.length - 1 - suffixLen] === next[next.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const deleteCount = current.length - prefixLen - suffixLen;
  const insertStr = next.slice(prefixLen, next.length - suffixLen);

  const perform = () => {
    if (deleteCount > 0) {
      ytext.delete(prefixLen, deleteCount);
    }
    if (insertStr.length > 0) {
      ytext.insert(prefixLen, insertStr);
    }
  };

  const doc = ytext.doc;
  if (doc) {
    doc.transact(perform, origin);
  } else {
    perform();
  }
}
