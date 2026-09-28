// Shared text-edit helpers (story 9, text.model): the character-limit clamp
// and the minimal Y.Text diff, shared by sticky notes (story 2) and text
// objects (story 9). Framework-free; moved from src/client/objects/
// StickyText.ts, which re-exports them with the sticky defaults.

import * as Y from 'yjs';

/** Truncates `next` to at most `max` characters. */
export function clampToLimit(next: string, max: number): string {
  return next.length > max ? next.slice(0, max) : next;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/**
 * Applies the minimal change (common prefix + common suffix) from the
 * Y.Text's current value to `next`: at most one delete and/or one insert
 * inside one transaction. A full replace would destroy concurrent typing by
 * others, so this is required, not optional.
 *
 * Diff boundaries are snapped away from the middle of surrogate pairs so
 * emoji are never split.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  // Common prefix.
  let start = 0;
  const minLen = Math.min(current.length, next.length);
  while (start < minLen && current.charCodeAt(start) === next.charCodeAt(start)) start += 1;
  // Snap the boundary out of a surrogate pair (well-formed text: a low
  // surrogate only follows its high surrogate).
  if (start < current.length && isLowSurrogate(current.charCodeAt(start))) start -= 1;

  // Common suffix (not overlapping the prefix).
  let endCurrent = current.length;
  let endNext = next.length;
  while (
    endCurrent > start &&
    endNext > start &&
    current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)
  ) {
    endCurrent -= 1;
    endNext -= 1;
  }
  // Snap the suffix start out of a surrogate pair on both sides.
  if (endCurrent < current.length && isLowSurrogate(current.charCodeAt(endCurrent))) endCurrent -= 1;
  if (endNext < next.length && isLowSurrogate(next.charCodeAt(endNext))) endNext -= 1;

  const deleteLength = endCurrent - start;
  const insertText = next.slice(start, endNext);
  if (deleteLength === 0 && insertText.length === 0) return;

  const d = ytext.doc;
  if (d === null) return; // unbound text: nothing to transact against
  d.transact(
    () => {
      if (deleteLength > 0) ytext.delete(start, deleteLength);
      if (insertText.length > 0) ytext.insert(start, insertText);
    },
    origin,
  );
}
