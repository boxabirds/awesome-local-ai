// Text editing helpers shared by every text-bearing object type (sticky notes,
// text objects): minimal Y.Text diffs and length limits, surrogate-pair safe.
import type * as Y from 'yjs';

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Largest cut index <= `index` that does not split a surrogate pair. */
function safeCut(text: string, index: number): number {
  if (index > 0 && index < text.length && isHighSurrogate(text.charCodeAt(index - 1)) && isLowSurrogate(text.charCodeAt(index))) {
    return index - 1;
  }
  return index;
}

/** Keeps at most `max` characters (UTF-16 units), never splitting an emoji's surrogate pair. */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  return next.slice(0, safeCut(next, max));
}

export interface TextChange {
  /** Index where `prev` and `next` start to differ. */
  start: number;
  /** Number of characters removed from `prev` at `start`. */
  deleteCount: number;
  /** Text inserted at `start`. */
  insert: string;
}

/** Common prefix + common suffix diff, surrogate-pair safe. */
export function diffText(prev: string, next: string): TextChange {
  const maxPrefix = Math.min(prev.length, next.length);
  let start = 0;
  while (start < maxPrefix && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
  // Do not end the prefix between the halves of a surrogate pair.
  if (start > 0 && isHighSurrogate(prev.charCodeAt(start - 1))) start--;
  let suffix = 0;
  const maxSuffix = maxPrefix - start;
  while (
    suffix < maxSuffix &&
    prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++;
  }
  // Do not start the suffix on the low half of a surrogate pair.
  if (suffix > 0 && isLowSurrogate(prev.charCodeAt(prev.length - suffix))) suffix--;
  return {
    start,
    deleteCount: prev.length - start - suffix,
    insert: next.slice(start, next.length - suffix),
  };
}

/**
 * Applies the edit `prev` → `next` but keeps the result within `max` by dropping
 * the part of the inserted text that does not fit (typing in the middle of a full
 * note adds nothing; pasting 1,200 characters into an empty note keeps the first 1,000).
 * Returns the kept text and, when something was dropped, the caret position at the
 * end of the kept insertion (`null` when nothing was dropped).
 */
export function clampEdit(prev: string, next: string, max: number): { text: string; caret: number | null } {
  if (next.length <= max) return { text: next, caret: null };
  const change = diffText(prev, next);
  const room = Math.max(0, max - (prev.length - change.deleteCount));
  const kept = clampToLimit(change.insert, room);
  const text = clampToLimit(next.slice(0, change.start) + kept + next.slice(change.start + change.insert.length), max);
  return { text, caret: Math.min(change.start + kept.length, text.length) };
}

/** Rewrites `ytext` to `next` with one minimal delete and/or insert in one transaction. */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const prev = ytext.toString();
  if (prev === next) return;
  const change = diffText(prev, next);
  const apply = () => {
    if (change.deleteCount > 0) ytext.delete(change.start, change.deleteCount);
    if (change.insert.length > 0) ytext.insert(change.start, change.insert);
  };
  if (ytext.doc) ytext.doc.transact(apply, origin);
  else apply();
}
