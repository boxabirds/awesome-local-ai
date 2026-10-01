// src/shared/text-edit.ts
// Shared text editing helpers: clampToLimit and applyTextDiff.
// Used by both sticky notes (story 2) and text objects (story 9).

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from './board-model';

/**
 * Clamps a string to at most `max` characters.
 */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  return next.slice(0, max);
}

/**
 * Apply a minimal diff to a Y.Text: find common prefix and suffix,
 * then delete the middle of the old and insert the middle of the new.
 * Surrogate-pair safe.
 *
 * Changes are applied with LOCAL_ORIGIN so that typing enters
 * this tab's undo history and is never attributed to a remote peer.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown = LOCAL_ORIGIN): void {
  const current = ytext.toString();
  if (current === next) return;

  // Find common prefix
  let prefixLen = 0;
  const maxPrefix = Math.min(current.length, next.length);
  while (prefixLen < maxPrefix && current[prefixLen] === next[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix (not overlapping with prefix)
  let suffixLen = 0;
  const maxSuffix = Math.min(current.length, next.length) - prefixLen;
  while (suffixLen < maxSuffix && current[current.length - 1 - suffixLen] === next[next.length - 1 - suffixLen]) {
    suffixLen++;
  }

  const deleteStart = prefixLen;
  const deleteLen = current.length - prefixLen - suffixLen;
  const insertStr = next.slice(prefixLen, next.length - suffixLen);

  // Group the delete + insert in one LOCAL_ORIGIN transaction so the
  // per-client UndoManager captures it as a local change.
  ytext.doc!.transact(() => {
    if (deleteLen > 0) {
      ytext.delete(deleteStart, deleteLen);
    }
    if (insertStr.length > 0) {
      ytext.insert(prefixLen, insertStr);
    }
  }, origin);
}
