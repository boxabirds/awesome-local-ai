/**
 * The text logic every typed board object shares.
 *
 * It came from story 2's `src/client/objects/StickyText.ts`, where a sticky note
 * was the only thing anybody could type into. A text object (story 9) needs the
 * same three rules and must not grow a second copy of them that can drift, so
 * they live here, in `shared`, with the limit passed in rather than assumed:
 *
 * - **The limit is applied where the text is accepted.** `clampToLimit` is the
 *   whole of `text.limit` and `sticky.limit`: characters past the maximum are
 *   never written, so nothing has to be trimmed out of the document later.
 * - **Minimal edits.** `applyTextDiff` writes the smallest change that turns the
 *   current text into the next one (common prefix + common suffix). A full
 *   replace would destroy text a teammate is typing at the same moment — the
 *   merge story 3 promises and `text.concurrent` repeats for text objects.
 * - **Surrogate pairs stay whole.** A diff boundary never falls between the two
 *   halves of an emoji, which would leave a lone half behind.
 *
 * No React and no layout here; `fitFontSize`, which measures an element, stays
 * with the note that uses it.
 */
import type * as Y from 'yjs';

/** Keep at most `max` characters; anything longer is cut off. */
export function clampToLimit(next: string, max: number): string {
  return next.length <= max ? next : next.slice(0, max);
}

/** True for the first half of a UTF-16 surrogate pair. */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** True for the second half of a UTF-16 surrogate pair. */
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** The edit region `[start, end)` of turning `current` into `next`. */
function diffRange(
  current: string,
  next: string,
): { start: number; endCurrent: number; endNext: number } {
  let start = 0;
  const shared = Math.min(current.length, next.length);
  while (start < shared && current[start] === next[start]) start += 1;

  let endCurrent = current.length;
  let endNext = next.length;
  while (endCurrent > start && endNext > start && current[endCurrent - 1] === next[endNext - 1]) {
    endCurrent -= 1;
    endNext -= 1;
  }

  // Never cut a surrogate pair in half: pull the start back before a high
  // surrogate and push the end past a low one, so the change covers whole
  // characters only.
  if (start > 0 && (isHighSurrogate(current.charCodeAt(start - 1)) || isHighSurrogate(next.charCodeAt(start - 1)))) {
    start -= 1;
  }
  if (endCurrent < current.length && isLowSurrogate(current.charCodeAt(endCurrent))) endCurrent += 1;
  if (endNext < next.length && isLowSurrogate(next.charCodeAt(endNext))) endNext += 1;

  return { start, endCurrent, endNext };
}

/**
 * Where a caret at `caret` in `previous` belongs in `next`.
 *
 * Used when somebody else's typing arrives while an object is being edited: the
 * text in the field has to change, and the caret has to come with it rather than
 * jump to the start. The change is treated as one region (the same shape
 * `diffRange` describes): a caret before it does not move, and a caret at or after
 * it moves by what the change grew or shrank by, never landing before the start of
 * the change.
 */
export function shiftCaret(caret: number, previous: string, next: string): number {
  const { start, endCurrent, endNext } = diffRange(previous, next);
  if (caret <= start) return caret;
  const deleted = endCurrent - start;
  const inserted = endNext - start;
  return Math.max(start, caret - deleted + inserted);
}

/**
 * Write `next` into `ytext` with the fewest operations possible: at most one
 * delete and one insert, inside a single transaction.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return; // no change, so no transaction and no sync traffic

  const { start, endCurrent, endNext } = diffRange(current, next);
  const deleteLength = endCurrent - start;
  const insertion = next.slice(start, endNext);

  const write = () => {
    if (deleteLength > 0) ytext.delete(start, deleteLength);
    if (insertion.length > 0) ytext.insert(start, insertion);
  };

  const doc = ytext.doc;
  if (doc) doc.transact(write, origin);
  else write();
}
