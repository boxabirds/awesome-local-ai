import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from './config';

/** Clamp string to max characters. */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) {
    return next;
  }
  return next.slice(0, max);
}

/**
 * Apply minimal diff between current Y.Text content and next string.
 * Uses common prefix + common suffix to preserve concurrent edits.
 * Works on UTF-16 code units (which is what Yjs uses internally).
 */
export function applyTextDiff(
  ytext: Y.Text,
  next: string,
  origin: unknown,
): void {
  const current = ytext.toString();

  // Find common prefix length (UTF-16 code units)
  let prefixLen = 0;
  const minLen = Math.min(current.length, next.length);
  while (prefixLen < minLen && current.charCodeAt(prefixLen) === next.charCodeAt(prefixLen)) {
    prefixLen++;
  }

  // Find common suffix length (from end, UTF-16 code units)
  let suffixLen = 0;
  const currRemaining = current.length - prefixLen;
  const nextRemaining = next.length - prefixLen;

  while (
    suffixLen < currRemaining &&
    suffixLen < nextRemaining &&
    current.charCodeAt(current.length - 1 - suffixLen) === next.charCodeAt(next.length - 1 - suffixLen)
  ) {
    suffixLen++;
  }

  // Delete range: from prefixLen to (current.length - suffixLen) in UTF-16 units
  const deleteStart = prefixLen;
  const deleteLength = current.length - prefixLen - suffixLen;

  // Insert: the middle part of next
  const insertStr = next.slice(prefixLen, next.length - suffixLen);

  // Try to find parent doc; apply in transaction if available
  try {
    const parentDoc = (ytext as any)._parent?._parent as Y.Doc | undefined;
    if (parentDoc) {
      parentDoc.transact(() => {
        if (deleteLength > 0) {
          ytext.delete(deleteStart, deleteLength);
        }
        if (insertStr.length > 0) {
          ytext.insert(deleteStart, insertStr);
        }
      }, origin);
    } else {
      // Direct application (for tests / detached Y.Texts)
      if (deleteLength > 0) {
        ytext.delete(deleteStart, deleteLength);
      }
      if (insertStr.length > 0) {
        ytext.insert(deleteStart, insertStr);
      }
    }
  } catch {
    // Fallback: direct application
    if (deleteLength > 0) {
      ytext.delete(deleteStart, deleteLength);
    }
    if (insertStr.length > 0) {
      ytext.insert(deleteStart, insertStr);
    }
  }
}

// Re-export for sticky notes (backward compat — story 2 callers unchanged)
export function clampStickyLimit(next: string): string {
  return clampToLimit(next, STICKY_TEXT_MAX_CHARS);
}
