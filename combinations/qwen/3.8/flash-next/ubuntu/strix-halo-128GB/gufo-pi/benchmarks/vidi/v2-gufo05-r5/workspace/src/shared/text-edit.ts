/**
 * The text-editing primitives every board object with characters shares (story 2 wrote them
 * for sticky notes; story 9 moved them here so text objects use the same ones):
 * `clampToLimit` for a length limit, and `applyTextDiff` for the minimal shared edit.
 *
 * `applyTextDiff` is what makes concurrent typing possible (story 3): a change from "abc" to
 * "abXc" is sent as one insert of "X" at index 2, not as a delete of the whole text followed
 * by an insert, so characters somebody else typed at the same moment survive the merge.
 */
import * as Y from 'yjs';

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Keeps at most `max` characters; characters beyond the limit are never stored.
 * A cut that would land inside an emoji is moved before it, so the kept text is always
 * valid Unicode.
 */
export function clampToLimit(next: string, max: number): string {
  const limit = Math.max(0, Math.floor(max));
  if (next.length <= limit) return next;
  const last = next.charCodeAt(limit - 1);
  const cut = isHighSurrogate(last) ? limit - 1 : limit;
  return next.slice(0, cut);
}

interface DiffRange {
  /** First character that differs (and where new text is inserted). */
  start: number;
  /** End of the characters to delete from the current text. */
  deleteEnd: number;
  /** End of the text to insert (slice of `next`). */
  insertEnd: number;
}

/**
 * Common prefix and common suffix of `current` and `next`, widened so no split ever
 * lands between the two halves of a surrogate pair.
 */
function diffRange(current: string, next: string): DiffRange {
  const longest = Math.min(current.length, next.length);
  let start = 0;
  while (start < longest && current[start] === next[start]) start += 1;

  let deleteEnd = current.length;
  let insertEnd = next.length;
  while (
    deleteEnd > start &&
    insertEnd > start &&
    current[deleteEnd - 1] === next[insertEnd - 1]
  ) {
    deleteEnd -= 1;
    insertEnd -= 1;
  }

  // Widen the edit outwards so a multi-code-unit character is replaced as a whole.
  const splitBefore = (text: string, index: number): boolean =>
    index > 0 && isHighSurrogate(text.charCodeAt(index - 1));
  const splitAfter = (text: string, index: number): boolean =>
    index < text.length && isLowSurrogate(text.charCodeAt(index));

  if (splitBefore(current, start) || splitBefore(next, start)) start -= 1;
  while (splitAfter(current, deleteEnd) || splitAfter(next, insertEnd)) {
    deleteEnd += 1;
    insertEnd += 1;
  }
  return { start, deleteEnd, insertEnd };
}

/**
 * Writes `next` into a shared text with the smallest possible edit: one delete and one
 * insert, inside a single transaction.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  const { start, deleteEnd, insertEnd } = diffRange(current, next);
  const remove = deleteEnd - start;
  const inserted = next.slice(start, insertEnd);

  const run = () => {
    if (remove > 0) ytext.delete(start, remove);
    if (inserted.length > 0) ytext.insert(start, inserted);
  };

  if (ytext.doc) ytext.doc.transact(run, origin);
  else run();
}
