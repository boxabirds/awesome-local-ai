/**
 * Pure text-editing utilities shared by sticky notes (story 2) and free text
 * (story 9). Framework-free so they can be unit-tested in node.
 *
 * Y.Text indices in Yjs 13 are UTF-16 code units, so the diff works in
 * code units; a change that touches a surrogate pair always deletes/inserts
 * whole pairs (the diff never starts or ends mid-pair in practice because
 * the textarea edits whole code units too).
 */

import * as Y from 'yjs';

/** Keep at most `max` characters; the tail is dropped. */
export function clampToLimit(next: string, max: number): string {
  return next.length > max ? next.slice(0, max) : next;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Apply the minimal change that turns `ytext` into `next`: common prefix and
 * suffix are kept, leaving at most one delete and one insert in a single
 * transaction. A full replace would destroy concurrent typing, so the
 * minimal diff is required.
 *
 * The diff boundaries are nudged back over a leading high surrogate when the
 * common prefix/suffix would end mid surrogate pair: Yjs corrupts the text
 * if a delete or insert lands between the two halves of a pair, so the
 * changed span always covers whole pairs.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  const minLen = Math.min(current.length, next.length);
  let prefix = 0;
  while (prefix < minLen && current.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1;
  // Never end the prefix between the two halves of a pair in `current`.
  if (prefix > 0 && isHighSurrogate(current.charCodeAt(prefix - 1))) prefix -= 1;

  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    current.charCodeAt(current.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  // Never start the suffix between the two halves of a pair in `current`.
  const endBefore = current.length - suffix;
  if (endBefore > 0 && isHighSurrogate(current.charCodeAt(endBefore - 1))) suffix += 1;

  const deleteLength = current.length - prefix - suffix;
  const runInTransaction = (fn: () => void): void => {
    if (ytext.doc) {
      ytext.doc.transact(fn, origin);
    } else {
      fn();
    }
  };

  if (deleteLength < 0) {
    runInTransaction(() => {
      ytext.delete(0, current.length);
      ytext.insert(0, next);
    });
    return;
  }
  const insertText = next.slice(prefix, next.length - suffix);

  runInTransaction(() => {
    if (deleteLength > 0) ytext.delete(prefix, deleteLength);
    if (insertText.length > 0) ytext.insert(prefix, insertText);
  });
}

/**
 * One Quill-style text delta operation, as produced by Yjs
 * `YTextEvent.delta` (and the `applyDelta` format).
 */
export interface TextDeltaOp {
  retain?: number;
  insert?: string | object;
  delete?: number;
}

/**
 * Apply a Yjs text delta to a plain string, preserving the editor's
 * selection (caret or range).
 */
export function applyTextDelta(
  text: string,
  delta: readonly TextDeltaOp[],
  selStart: number,
  selEnd: number,
): { text: string; start: number; end: number } {
  let out = '';
  let consumed = 0;
  for (const op of delta) {
    if (typeof op.retain === 'number') {
      out += text.slice(consumed, consumed + op.retain);
      consumed += op.retain;
    } else if (typeof op.delete === 'number') {
      consumed += op.delete;
    } else if (typeof op.insert === 'string') {
      out += op.insert;
    }
  }
  out += text.slice(consumed);

  const mapPos = (p: number): number => {
    let idx = 0;
    let nidx = 0;
    for (const op of delta) {
      if (typeof op.retain === 'number') {
        const n = op.retain;
        if (idx + n > p) return nidx + (p - idx);
        idx += n;
        nidx += n;
      } else if (typeof op.delete === 'number') {
        const n = op.delete;
        if (idx + n > p) return nidx;
        idx += n;
      } else if (typeof op.insert === 'string') {
        if (idx <= p) nidx += op.insert.length;
      }
    }
    return nidx + (p - idx);
  };

  return { text: out, start: mapPos(selStart), end: mapPos(selEnd) };
}
