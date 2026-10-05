/**
 * The two rules every editable text on the board shares, whatever object it belongs to.
 *
 * These came out of story 2, where they were the sticky note's: a length limit that drops what will not
 * fit, and a write into a `Y.Text` that changes only what is different. They live here now because from
 * story 9 there is more than one kind of text on the board, and two kinds of text with two different
 * length limits. A limit that is a parameter rather than a constant is the whole of the difference; the
 * rules themselves are the same ones, which is why they were moved rather than copied — a fix to the diff
 * has to reach both types at once, and a copy is a fix that one type never gets.
 *
 * Framework-free like the rest of `shared`: story 4's server validates documents with these functions.
 */
import type * as Y from 'yjs';

/**
 * Drop everything past `max` characters.
 *
 * Typing or pasting that would exceed the limit adds nothing beyond the `max`th character; below the
 * limit the text is returned untouched (identity included, so callers can compare and skip a write that
 * would change nothing). A limit that is not a usable number accepts nothing: a board that cannot say
 * how long text may be should not be writing any.
 */
export function clampToLimit(next: string, max: number): string {
  if (!Number.isFinite(max) || max < 0) return '';
  return next.length > max ? next.slice(0, max) : next;
}

/**
 * Write `next` into a `Y.Text` with the smallest change that gets there: a common prefix and a common
 * suffix are found and only the difference between them is written, as one delete and/or one insert in
 * one transaction.
 *
 * The minimal diff is not an optimisation: replacing the whole text would discard what other people
 * typed between the last keystroke and this one as soon as the board is shared (story 3). Text with no
 * document attached cannot be written, so it is left alone.
 *
 * The `origin` is the caller's: it is what every local write is marked with, and what the undo history
 * and the sync protocol both filter on. Passing anything else would put this keystroke in somebody
 * else's undo step, or send it back to where it came from.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const doc = ytext.doc;
  if (!doc) return;

  const current = ytext.toString();
  if (current === next) return;

  const shorter = Math.min(current.length, next.length);
  let start = 0;
  while (start < shorter && current.charCodeAt(start) === next.charCodeAt(start)) start += 1;

  let currentEnd = current.length;
  let nextEnd = next.length;
  while (
    currentEnd > start &&
    nextEnd > start &&
    current.charCodeAt(currentEnd - 1) === next.charCodeAt(nextEnd - 1)
  ) {
    currentEnd -= 1;
    nextEnd -= 1;
  }

  const deleteLength = currentEnd - start;
  const insertText = next.slice(start, Math.max(start, nextEnd));
  if (deleteLength === 0 && insertText === '') return;

  doc.transact(() => {
    if (deleteLength > 0) ytext.delete(start, deleteLength);
    if (insertText !== '') ytext.insert(start, insertText);
  }, origin);
}

/**
 * Whether a character counter has anything left to warn about: only once the text is within `threshold`
 * characters of its limit.
 *
 * A counter that is always on is a number nobody reads, and a field that counts every keystroke out loud is
 * one that tells a person they are being watched by a spreadsheet. Both objects show the same shape of
 * warning at the same distance from their own limit — which is why the limit and the distance are both
 * parameters, and why neither object gets to write this arithmetic again.
 */
export function counterVisible(length: number, max: number, threshold: number): boolean {
  if (!Number.isFinite(length) || !Number.isFinite(max) || !Number.isFinite(threshold)) return false;
  return max - length <= threshold;
}
