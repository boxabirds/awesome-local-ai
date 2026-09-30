// Text editing helpers shared by every object type with editable text
// (story 2 sticky notes, story 9 free text): length clamp and minimal Y.Text diff.
import type * as Y from 'yjs';

const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;

export function isHighSurrogate(code: number): boolean {
  return code >= HIGH_SURROGATE_MIN && code <= HIGH_SURROGATE_MAX;
}

export function isLowSurrogate(code: number): boolean {
  return code >= LOW_SURROGATE_MIN && code <= LOW_SURROGATE_MAX;
}

/** Keeps at most `max` UTF-16 code units, never splitting a surrogate pair. */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  let end = Math.max(0, max);
  if (end > 0 && isHighSurrogate(next.charCodeAt(end - 1)) && isLowSurrogate(next.charCodeAt(end))) end -= 1;
  return next.slice(0, end);
}

/**
 * The single edit that turns `prev` into `next`: `deleteCount` characters at
 * `start` replaced by `insert` (common prefix and suffix kept).
 */
export function diffText(prev: string, next: string): { start: number; deleteCount: number; insert: string } {
  const minLen = Math.min(prev.length, next.length);
  let start = 0;
  while (start < minLen && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
  if (start > 0 && isHighSurrogate(prev.charCodeAt(start - 1))) start--;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)) {
    endPrev--;
    endNext--;
  }
  if (endPrev < prev.length && isLowSurrogate(prev.charCodeAt(endPrev))) {
    endPrev++;
    endNext++;
  }
  return { start, deleteCount: endPrev - start, insert: next.slice(start, endNext) };
}

/**
 * Applies the minimal change turning `ytext` into `next`: one delete and/or one
 * insert between the common prefix and common suffix, in one transaction.
 * Never a full replace, so concurrent edits by others survive (story 3).
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const prev = ytext.toString();
  if (prev === next) return;
  const { start, deleteCount, insert } = diffText(prev, next);
  const apply = () => {
    if (deleteCount > 0) ytext.delete(start, deleteCount);
    if (insert.length > 0) ytext.insert(start, insert);
  };
  if (ytext.doc) ytext.doc.transact(apply, origin);
  else apply();
}
