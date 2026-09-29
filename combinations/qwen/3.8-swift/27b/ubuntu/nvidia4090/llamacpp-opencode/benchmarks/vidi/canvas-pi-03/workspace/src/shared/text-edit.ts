import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from './config';

/** Truncates `next` to at most `max` characters (default STICKY_TEXT_MAX_CHARS). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length > max ? next.slice(0, max) : next;
}

/**
 * A Y.Text change delta: ops are exclusive — each has exactly one of
 * `retain` / `insert` / `delete`.
 */
export type TextDeltaOp = {
  retain?: number;
  insert?: string | object;
  delete?: number;
};

/**
 * Re-map a local caret (a code-unit offset into the text as it was before a
 * remote Y.Text update) through the update's `delta`, returning the caret
 * offset in the new text. Used to keep a live editor's caret stable while
 * remote characters are inserted/removed, so concurrent typing never loses
 * characters.
 */
export function adjustCaret(caret: number, delta: readonly TextDeltaOp[]): number {
  let pos = 0;
  let next = caret;
  for (const op of delta) {
    if (op.retain !== undefined) {
      pos += op.retain;
    } else if (op.insert !== undefined) {
      // Insertion lands at old position `pos`; if it is before the caret the
      // caret shifts right by the inserted length. Y.Text inserts are strings.
      const len = typeof op.insert === 'string' ? op.insert.length : 0;
      if (pos < caret) next += len;
    } else if (op.delete !== undefined) {
      const end = pos + op.delete;
      if (end <= caret) next -= op.delete;
      else if (pos < caret) next = pos; // caret inside the deleted range
    }
  }
  return Math.max(0, next);
}

/**
 * Applies the minimal change (common prefix + common suffix) that turns the
 * current Y.Text content into `next`: at most one delete and one insert in a
 * single transaction, surrogate-pair safe.
 *
 * A minimal diff is required (not a full replace) so that concurrent typing by
 * other clients keeps merging (story 3; shared by sticky notes, story 2, and
 * text objects, story 9).
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown = null): void {
  const cur = ytext.toString();
  if (cur === next) return;

  const curLen = cur.length;
  const nextLen = next.length;
  const minLen = Math.min(curLen, nextLen);

  // Common prefix (code-unit based).
  let start = 0;
  while (start < minLen && cur.charCodeAt(start) === next.charCodeAt(start)) start++;

  // Common suffix, not crossing the prefix.
  let endCur = curLen;
  let endNext = nextLen;
  while (endCur > start && endNext > start && cur.charCodeAt(endCur - 1) === next.charCodeAt(endNext - 1)) {
    endCur--;
    endNext--;
  }

  // Surrogate-pair safety: if the diff boundary splits a pair, extend the
  // delete/insert region by one unit so no orphan surrogate is left behind.
  if (start > 0 && (cur.charCodeAt(start - 1) & 0xfc00) === 0xd800) start--;
  if (endCur < curLen && (cur.charCodeAt(endCur) & 0xfc00) === 0xdc00) endCur++;

  const deleteLength = endCur - start;
  const insert = next.slice(start, endNext);

  const apply = () => {
    if (deleteLength > 0) ytext.delete(start, deleteLength);
    if (insert.length > 0) ytext.insert(start, insert);
  };

  // One transaction per input event; falls back to a bare apply when the
  // text is not (yet) attached to a doc (e.g. unit tests).
  if (ytext.doc) ytext.doc.transact(apply, origin);
  else apply();
}
