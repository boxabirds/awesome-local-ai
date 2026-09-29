/**
 * Shared text-edit helpers (story 9).
 *
 * These were previously in StickyText.ts (story 2); they are extracted here
 * so both sticky notes and text objects can share them without one importing
 * through the other's module.
 */
import type * as Y from 'yjs';

/** True for half of a surrogate pair, which must never be split apart. */
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Cut `next` at the character limit. When the cut would land between the two
 * code units of a surrogate pair the pair is kept by cutting one unit earlier.
 */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  let cut = max;
  if (isLowSurrogate(next.charCodeAt(cut))) cut -= 1;
  return cut <= 0 ? '' : next.slice(0, cut);
}

/** Split a string into code points so a surrogate pair counts as one unit. */
function codePoints(value: string): string[] {
  return Array.from(value);
}

/**
 * Write `next` into `ytext` with the smallest change that produces it: a
 * common prefix and a common suffix are kept, everything between them is
 * replaced by one delete and/or one insert inside a single transaction.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  if (!ytext.doc) return;
  const before = ytext.toString();
  if (before === next) return;

  const oldChars = codePoints(before);
  const newChars = codePoints(next);

  let start = 0;
  const shared = Math.min(oldChars.length, newChars.length);
  while (start < shared && oldChars[start] === newChars[start]) start += 1;

  let oldEnd = oldChars.length;
  let newEnd = newChars.length;
  while (oldEnd > start && newEnd > start && oldChars[oldEnd - 1] === newChars[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  const removed = oldChars.slice(start, oldEnd).join('');
  const added = newChars.slice(start, newEnd).join('');
  if (removed.length === 0 && added.length === 0) return;

  // Y.Text indexes by UTF-16 code unit, hence `.length` of the prefix.
  const index = oldChars.slice(0, start).join('').length;

  ytext.doc.transact(() => {
    if (removed.length > 0) ytext.delete(index, removed.length);
    if (added.length > 0) ytext.insert(index, added);
  }, origin);
}