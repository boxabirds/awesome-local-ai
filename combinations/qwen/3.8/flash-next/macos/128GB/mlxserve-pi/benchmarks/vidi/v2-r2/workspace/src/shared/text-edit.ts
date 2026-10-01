// Text editing logic every object with editable text shares (story 9): the
// character limit and the minimal Y.Text edit for a new textarea value.
//
// applyTextDiff matters beyond neatness: story 3 merges concurrent typing, and a
// full replace would destroy what somebody else typed in the same object. A
// common prefix and suffix are left alone, so the update that goes over the wire
// is one small insert/delete.
//
// Story 2's `client/objects/StickyText` re-exports both functions with the
// sticky note's own limit, so a note and a text object edit their Y.Text the
// same way and stay one merged text under a concurrent edit.
//
// Characters are counted as the user counts them (Unicode code points), so an
// emoji is one character and a cut at the limit can never split a surrogate pair.

import * as Y from 'yjs';

/** Keep at most `max` characters, dropping everything after them. */
export function clampToLimit(next: string, max: number): string {
  if (!Number.isFinite(max) || max <= 0) return '';
  if (next.length <= max) return next; // cannot be too long by any count
  const chars = Array.from(next);
  if (chars.length <= max) return next; // long in code units, short in characters
  return chars.slice(0, max).join('');
}

/** UTF-16 offset of the `index`th character. */
function unitOffset(value: string, index: number): number {
  if (index <= 0) return 0;
  return Array.from(value).slice(0, index).join('').length;
}

/**
 * Make a Y.Text hold `next` with the smallest change that gets there. Does
 * nothing (and opens no transaction) when the text already says `next`.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  const from = Array.from(current);
  const to = Array.from(next);

  let start = 0;
  const shared = Math.min(from.length, to.length);
  while (start < shared && from[start] === to[start]) start += 1;

  let endFrom = from.length;
  let endTo = to.length;
  while (endFrom > start && endTo > start && from[endFrom - 1] === to[endTo - 1]) {
    endFrom -= 1;
    endTo -= 1;
  }

  const deleteFrom = unitOffset(current, start);
  const deleteUnits = unitOffset(current, endFrom) - deleteFrom;
  const insertText = to.slice(start, endTo).join('');

  const run = (): void => {
    if (deleteUnits > 0) ytext.delete(deleteFrom, deleteUnits);
    if (insertText !== '') ytext.insert(deleteFrom, insertText);
  };
  const doc = ytext.doc;
  if (doc !== null) doc.transact(run, origin);
  else run();
}
