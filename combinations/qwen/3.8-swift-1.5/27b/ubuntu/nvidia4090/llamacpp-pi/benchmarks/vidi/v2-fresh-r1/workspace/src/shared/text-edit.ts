// Shared text-edit helpers: character-limit clamping and minimal Y.Text diffs.
// Used by sticky notes (story 2) and text objects (story 9) so both editors
// clamp and sync identically. No logic is duplicated: StickyText.ts re-exports
// these.

import type * as Y from 'yjs';

/**
 * Clamp `next` to at most `max` characters. The limit is applied to the
 * resulting length, so a paste of 5,001 characters becomes exactly 5,000.
 */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  return next.slice(0, max);
}

/**
 * Apply a minimal diff (common prefix + common suffix) to a Y.Text.
 * One delete and/or one insert inside one transaction.
 * Surrogate-pair safe.
 *
 * Opens its own transaction with `origin`; callers do not wrap it.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  // Find common prefix
  let prefixLen = 0;
  const maxPrefix = Math.min(current.length, next.length);
  while (prefixLen < maxPrefix && current[prefixLen] === next[prefixLen]) {
    prefixLen++;
  }

  // Surrogate-pair safety: don't split a surrogate pair at the prefix boundary
  if (prefixLen > 0) {
    const code = current.charCodeAt(prefixLen - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      prefixLen--;
    }
  }

  // Find common suffix (not overlapping with prefix)
  let suffixLen = 0;
  const maxSuffix = Math.min(current.length, next.length) - prefixLen;
  while (
    suffixLen < maxSuffix &&
    current[current.length - 1 - suffixLen] === next[next.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  // Surrogate-pair safety: don't split a surrogate pair at the suffix boundary
  if (suffixLen > 0) {
    const code = current.charCodeAt(current.length - suffixLen);
    if (code >= 0xdc00 && code <= 0xdfff) {
      suffixLen--;
    }
  }

  const deleteLen = current.length - prefixLen - suffixLen;
  const insertStr = next.slice(prefixLen, next.length - suffixLen);

  if (deleteLen === 0 && insertStr.length === 0) return;

  ytext.doc!.transact(() => {
    if (deleteLen > 0) {
      ytext.delete(prefixLen, deleteLen);
    }
    if (insertStr.length > 0) {
      ytext.insert(prefixLen, insertStr);
    }
  }, origin);
}
