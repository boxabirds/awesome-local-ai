// Shared text editing: the rules every editable object on the board uses.
//
// A sticky note and a free text object edit their text the same way — a textarea
// whose whole value is reconciled into a Y.Text — so the reconciliation lives
// here once instead of twice. Story 9 moved `clampToLimit` and `applyTextDiff`
// out of the sticky note's own module (which re-exports them with its own
// character limit, so story 2's callers are unchanged) and added the base-aware
// half, `diffText` and `applyTextDelta`, which story 3's concurrent typing
// depends on.
//
// Two reconciles, on purpose:
//   `applyTextDiff`  diffs the new value against the shared text as it is *now*.
//   `applyTextDelta` diffs it against the text this document last *agreed* —
//                  which is what lets two people type into one object at the
//                  same time without losing one another's characters.
// An editor that is keeping a textarea in step with a shared text over time must
// use the second one; the first is for writing a whole value in one go.

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from './board-model';

/**
 * Keep at most `max` characters: input or a paste that would go past the limit
 * adds nothing beyond it. A limit that is not a usable number keeps nothing at
 * all, so a document written by something else can never make a negative or NaN
 * limit.
 *
 * The cut is made between whole characters: a limit that falls between the two
 * halves of an emoji keeps neither half, because a lone half is not a character
 * and no amount of appending will make one.
 */
export function clampToLimit(next: string, max: number): string {
  if (!Number.isFinite(max) || max <= 0) return '';
  if (next.length <= max) return next;
  const kept = next.slice(0, Math.trunc(max));
  const last = kept.charCodeAt(kept.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? kept.slice(0, -1) : kept;
}

/** An insertion or deletion in a shared text, given as an offset range. */
export interface TextDelta {
  /** Where in the base text the change starts. */
  start: number;
  /** Where in the base text it ends (an insertion has `start === baseEnd`). */
  baseEnd: number;
  /** What replaces `base.slice(start, baseEnd)`, empty for a deletion. */
  insert: string;
}

/** UTF-16 length of a run of code points (a surrogate pair counts as 2). */
function utf16Length(codePoints: string[]): number {
  let total = 0;
  for (const point of codePoints) total += point.length;
  return total;
}

/**
 * Write `next` into `ytext` with the minimal change: the common prefix and
 * common suffix are kept, so one write is one insert (or delete) — never
 * delete-all + insert-all, which would destroy what other people are typing.
 * Diffing on code points means a surrogate pair is never cut in half; the whole
 * pair is inserted or removed.
 *
 * The change runs in exactly one transaction with `origin` (LOCAL_ORIGIN from
 * the editor), which stories 3 and 8 use to recognise local edits.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  const before = Array.from(current);
  const after = Array.from(next);

  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }

  const deleteAt = utf16Length(before.slice(0, start));
  const deleteLength = utf16Length(before.slice(start, endBefore));
  const insertText = after.slice(start, endAfter).join('');
  if (deleteLength === 0 && insertText === '') return;

  const apply = () => {
    // Delete first, then insert at the same offset: one delete and/or one
    // insert, and the resulting delta reads retain / delete / insert.
    if (deleteLength > 0) ytext.delete(deleteAt, deleteLength);
    if (insertText !== '') ytext.insert(deleteAt, insertText);
  };
  const doc = ytext.doc;
  if (doc === null) apply();
  else doc.transact(apply, origin);
}

/**
 * The one change between two texts, as offsets into the text they started from.
 *
 * Diffing against the text a shared document last agreed with the room — rather
 * than against whatever is in the textarea — is what lets two people type into
 * one object at once without losing one another's characters (story 3): each
 * side reports only its own edit, and yjs merges it with the edit that arrived
 * in the meantime. `applyTextDiff` cannot do this job: it diffs against the
 * shared text as it is now, so a textarea that is behind by somebody else's
 * characters reports their absence as a deletion.
 *
 * Only the longest common prefix and suffix are trimmed, so this reports one
 * contiguous change; a textarea edited in two places between two renders
 * reports both as one replacement, which yjs still merges correctly.
 */
export function diffText(base: string, next: string): TextDelta {
  let start = 0;
  const shared = Math.min(base.length, next.length);
  while (start < shared && base.charCodeAt(start) === next.charCodeAt(start)) start += 1;
  let baseEnd = base.length;
  let nextEnd = next.length;
  while (
    baseEnd > start &&
    nextEnd > start &&
    base.charCodeAt(baseEnd - 1) === next.charCodeAt(nextEnd - 1)
  ) {
    baseEnd -= 1;
    nextEnd -= 1;
  }
  return { start, baseEnd, insert: next.slice(start, nextEnd) };
}

/**
 * Apply one local edit to a shared text, in one transaction with `origin`.
 *
 * The range is measured against `base`, the text this document last agreed. If
 * somebody else's change has made the shared text shorter since, the range is
 * clamped: deleting past the end of a shared text throws, and an exception here
 * would take the keystroke, and the transaction after it, with it.
 */
export function applyTextDelta(
  ytext: Y.Text,
  base: string,
  next: string,
  origin: unknown = LOCAL_ORIGIN,
): void {
  const { start, baseEnd, insert } = diffText(base, next);
  const doc = ytext.doc;
  const write = (): void => {
    const length = ytext.length;
    const from = Math.min(start, length);
    const to = Math.min(baseEnd, length);
    if (to > from) ytext.delete(from, to - from);
    if (insert.length > 0) ytext.insert(from, insert);
  };
  if (doc) doc.transact(write, origin);
  else write();
}
