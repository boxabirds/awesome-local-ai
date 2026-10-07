/**
 * The parts of text editing that are not about sticky notes (story 9, design
 * anchor `text.limit`).
 *
 * Story 2 grew these two rules inside `src/client/objects/StickyText.ts`, and
 * story 9 needs the same two for free text: the character limit that never cuts
 * an emoji in half, and the minimal diff into a shared `Y.Text` that leaves
 * somebody else's concurrent typing alone. They live here now, with no DOM, no
 * React and no sticky-note settings in them, and `StickyText.ts` re-exports them
 * so story 2's callers and tests are untouched.
 *
 * The limit itself stays per object type - `STICKY_TEXT_MAX_CHARS` for a note,
 * `TEXT_MAX_CHARS` for text - which is why both functions take it as an argument.
 */

import * as Y from 'yjs';

import { STICKY_TEXT_MAX_CHARS } from './config.js';

/** A high surrogate (first half of an emoji) at `index`? */
const isHighSurrogate = (value: string, index: number): boolean => {
  const code = value.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff;
};

/** A low surrogate (second half of an emoji) at `index`? */
const isLowSurrogate = (value: string, index: number): boolean => {
  const code = value.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff;
};

/**
 * Keep at most `max` characters. Characters beyond the limit are dropped, and a
 * cut that would land in the middle of an emoji (between a high and a low
 * surrogate) is moved back so no lone surrogate is ever stored.
 *
 * `max` defaults to the sticky note limit, which is what story 2 called it with.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (typeof next !== 'string') return '';
  const limit = Number.isFinite(max) && max >= 0 ? Math.floor(max) : 0;
  if (next.length <= limit) return next;
  // Cutting at `limit` must not split a surrogate pair: if the character just
  // before the cut is half an emoji, cut one earlier instead.
  let cut = limit;
  if (isHighSurrogate(next, cut - 1) && isLowSurrogate(next, cut)) cut -= 1;
  return next.slice(0, cut);
}

/**
 * Write the difference between the shared text and `next` into the shared text
 * as a minimal change: the common prefix and the common suffix are left alone,
 * so only what actually changed is replaced - one delete and/or one insert, in
 * one transaction with `origin`.
 *
 * The diff is computed over *characters* (`Array.from`), so an emoji is one
 * unit to be inserted or deleted and never cut in half; the indices handed to
 * Yjs are UTF-16 code-unit offsets, which is what Y.Text expects.
 *
 * A full replace would destroy text typed concurrently by somebody else
 * (story 3), which is why this is a diff.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  const before = Array.from(current);
  const after = Array.from(next);

  // Longest common prefix, then longest common suffix of what is left.
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  // Character counts -> UTF-16 code-unit offsets for the Yjs operations.
  const prefixUnits = before.slice(0, prefix).join('').length;
  const deleteUnits = before.slice(prefix, before.length - suffix).join('').length;
  const insert = after.slice(prefix, after.length - suffix).join('');

  const apply = () => {
    if (deleteUnits > 0) ytext.delete(prefixUnits, deleteUnits);
    if (insert.length > 0) ytext.insert(prefixUnits, insert);
  };

  const doc = ytext.doc;
  if (doc) doc.transact(apply, origin);
  else apply();
}
