/**
 * The text-editing primitives every object type with typed text shares.
 *
 * Story 2 wrote these for sticky notes alone, in `src/client/objects/StickyText.ts`.
 * Story 9 adds a second type with text — free text — and a second limit (5,000
 * characters against a note's 1,000), so the two rules that are not about sticky
 * notes at all live here instead:
 *
 *  - {@link clampToLimit}: the length limit, dropping whatever would cross it;
 *  - {@link applyTextDiff}: write a new string into a `Y.Text` as the *smallest* change
 *    that turns the old text into the new one, which is what lets two people type in
 *    the same object at the same time and keep every character (story 3, story 9
 *    `text.concurrent`). A delete-all/insert-all rewrite would destroy the other
 *    person's typing, so this is not an optimisation.
 *
 * Framework-free and DOM-free on purpose: the note's editor, the text object's editor
 * and the unit tests all call the same code.
 */

import type * as Y from 'yjs';

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Keep at most `max` characters — everything past the limit is dropped, so a 5,001
 * character paste into an empty text object keeps exactly the first 5,000.
 *
 * The cut is moved back when it would split an emoji in half: half a surrogate pair is
 * not a character, and storing one would show a replacement glyph.
 */
export function clampToLimit(next: string, max: number): string {
  const limit = Number.isFinite(max) && max >= 0 ? Math.floor(max) : 0;
  if (next.length <= limit) return next;
  let cut = limit;
  // A high surrogate just before the cut needs its low surrogate partner.
  if (cut > 0 && isHighSurrogate(next.charCodeAt(cut - 1))) cut -= 1;
  return next.slice(0, cut);
}

/** Where the common prefix of `a` and `b` ends, never inside a surrogate pair. */
function commonPrefix(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  // Splitting a pair here would delete one half and keep the other.
  if (i > 0 && isHighSurrogate(a.charCodeAt(i - 1))) i -= 1;
  return i;
}

/** How many trailing characters `a` and `b` share, never splitting a pair. */
function commonSuffix(a: string, b: string, after: number): number {
  const max = Math.min(a.length, b.length) - after;
  let i = 0;
  while (i < max && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i += 1;
  // The suffix must not start on the low half of a pair whose high half is deleted.
  if (i > 0 && isLowSurrogate(a.charCodeAt(a.length - i))) i -= 1;
  return i;
}

/**
 * Write `next` into `ytext` with the minimal change — at most one delete and one
 * insert — inside a single transaction tagged with `origin`.
 *
 * Text that already matches writes nothing, and text that has left the document
 * (its object was deleted) is left alone rather than resurrected.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const doc = ytext.doc;
  if (!doc) return;
  const current = ytext.toString();
  if (current === next) return;

  const prefix = commonPrefix(current, next);
  const suffix = commonSuffix(current, next, prefix);
  const deleteCount = current.length - prefix - suffix;
  const inserted = next.slice(prefix, next.length - suffix);

  doc.transact(() => {
    if (deleteCount > 0) ytext.delete(prefix, deleteCount);
    if (inserted.length > 0) ytext.insert(prefix, inserted);
  }, origin);
}

/**
 * The caret of an editor that is showing text somebody else changed.
 *
 * Moved here from the sticky note's text helpers when story 9 gave the board a second
 * kind of typed text: it is about a `Y.Text` delta and a caret, not about a note.
 */

/** One step of a change to the shared text, as Yjs describes it. */
export interface TextOp {
  insert?: string | object;
  retain?: number | object;
  delete?: number;
}

/** How many characters an inserted or retained run stands for. */
function runLength(run: string | number | object): number {
  return typeof run === 'number' ? run : typeof run === 'string' ? run.length : 1;
}

/**
 * Where `caret` — a position in the text as the editor was showing it — lands once
 * somebody else's `delta` has been applied.
 *
 * Text arriving before the caret carries it along; text deleted around it leaves the
 * caret at the point of the deletion, which is where the editor's own words now sit.
 * Inserted or deleted *at* the caret leaves it where it was: whose word wins a tie is
 * a matter of taste, and the taste here is that your own typing should not jump.
 */
export function mapCaret(caret: number, delta: readonly TextOp[]): number {
  const wanted = Math.max(0, caret);
  // `before` counts the text the editor was showing, `now` the text it holds.
  let before = 0;
  let now = 0;
  for (const op of delta) {
    if (op.insert !== undefined) {
      if (before >= wanted) break; // this change is at or after the caret
      now += runLength(op.insert);
      continue;
    }
    if (op.delete !== undefined) {
      if (before + op.delete >= wanted) return now;
      before += op.delete;
      continue;
    }
    if (op.retain === undefined) continue;
    const retain = runLength(op.retain);
    if (before + retain >= wanted) return now + (wanted - before);
    before += retain;
    now += retain;
  }
  // Nothing of the change reached the caret: it keeps its distance from the text
  // before it. A delta says nothing about the text after the last op (Yjs leaves a
  // trailing retain out), so a caller with the new text in hand clamps to it.
  return now + Math.max(0, wanted - before);
}
