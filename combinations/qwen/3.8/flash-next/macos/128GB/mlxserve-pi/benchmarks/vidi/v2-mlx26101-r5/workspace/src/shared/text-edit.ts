/**
 * The two rules every editable object's text shares: the length limit and the minimal diff into a
 * shared `Y.Text`.
 *
 * Story 2 wrote both of them for sticky notes alone, in `src/client/objects/StickyText.ts`. Story 9
 * adds a second type with a text body — free text — and a rule that lives inside one object type is
 * a rule two types can disagree about, so they live here instead: the limit and the diff are about
 * a `Y.Text` and a number, which is a fact no object type changes.
 *
 * `StickyText.ts` re-exports both, with `STICKY_TEXT_MAX_CHARS` as its default maximum, so story 2's
 * callers and tests read exactly as they did.
 */

import * as Y from 'yjs';

/** True for UTF-16 high surrogates (the first unit of an emoji pair). */
const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
/** True for UTF-16 low surrogates (the second unit of an emoji pair). */
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/**
 * Keeps at most `max` characters: typing or pasting that would exceed the limit adds nothing beyond
 * the last allowed character, and never leaves half of a surrogate pair behind — an emoji is two
 * UTF-16 units and only means anything as both of them.
 */
export function clampToLimit(next: string, max: number): string {
  if (typeof next !== 'string') return '';
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 0;
  if (next.length <= limit) return next;
  const cut = next.slice(0, limit);
  // Never leave half of a surrogate pair behind.
  const last = cut.length > 0 ? cut.charCodeAt(cut.length - 1) : 0;
  if (limit > 0 && isHighSurrogate(last)) return cut.slice(0, -1);
  return cut;
}

/**
 * Writes `next` into `ytext` with the smallest possible change: a common prefix and suffix are kept,
 * everything between them is one delete and/or one insert inside a single transaction. The minimal
 * diff is what lets two people type in the same object without destroying each other's characters
 * (story 3, and the same promise for text objects in story 9).
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  const oldLength = current.length;
  const newLength = next.length;

  let start = 0;
  while (start < oldLength && start < newLength && current[start] === next[start]) start += 1;
  let endOld = oldLength;
  let endNew = newLength;
  while (endOld > start && endNew > start && current[endOld - 1] === next[endNew - 1]) {
    endOld -= 1;
    endNew -= 1;
  }
  // Pull the boundaries out of any surrogate pair they landed in.
  if (
    start > 0 &&
    start < oldLength &&
    isHighSurrogate(current.charCodeAt(start - 1)) &&
    isLowSurrogate(current.charCodeAt(start))
  ) {
    start -= 1;
  }
  if (
    endOld > start &&
    endOld < oldLength &&
    isLowSurrogate(current.charCodeAt(endOld)) &&
    isHighSurrogate(current.charCodeAt(endOld - 1))
  ) {
    endOld -= 1;
    endNew -= 1;
  }

  const removed = endOld - start;
  const added = next.slice(start, endNew);
  const apply = () => {
    if (removed > 0) ytext.delete(start, removed);
    if (added.length > 0) ytext.insert(start, added);
  };
  const doc = ytext.doc;
  if (doc) doc.transact(apply, origin);
  else apply();
}
