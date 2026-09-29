// Text editing helpers shared by every object type that holds a Y.Text (sticky notes, text).
// Framework-free.
import type * as Y from 'yjs';

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Largest cut index <= `index` that does not split a surrogate pair. */
export function safeCut(text: string, index: number): number {
  return index > 0 && index < text.length && isLowSurrogate(text.charCodeAt(index))
    ? index - 1
    : index;
}

/** Keeps at most `max` characters (never splitting a surrogate pair). */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  return next.slice(0, safeCut(next, max));
}

/** Length of the common prefix and suffix of two strings, never splitting surrogate pairs. */
export function commonEnds(prev: string, next: string): { prefix: number; suffix: number } {
  const limit = Math.min(prev.length, next.length);
  let prefix = 0;
  while (prefix < limit && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;
  if (prefix > 0 && isHighSurrogate(prev.charCodeAt(prefix - 1))) prefix--;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++;
  }
  if (suffix > 0 && isLowSurrogate(next.charCodeAt(next.length - suffix))) suffix--;
  return { prefix, suffix };
}

/** Writes the minimal change (one delete and/or one insert) turning `ytext` into `next`. */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const prev = ytext.toString();
  if (prev === next) return;
  const { prefix, suffix } = commonEnds(prev, next);
  const deleteCount = prev.length - prefix - suffix;
  const insert = next.slice(prefix, next.length - suffix);
  const apply = () => {
    if (deleteCount > 0) ytext.delete(prefix, deleteCount);
    if (insert.length > 0) ytext.insert(prefix, insert);
  };
  if (ytext.doc) ytext.doc.transact(apply, origin);
  else apply();
}
