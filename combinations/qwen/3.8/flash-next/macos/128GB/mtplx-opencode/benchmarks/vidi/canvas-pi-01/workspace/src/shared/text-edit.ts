/**
 * Story 9 · shared text-editing primitives (design "shared text-edit.ts").
 *
 * The character limit and the minimal `Y.Text` diff originally lived in
 * `StickyText.ts` (story 2). Story 9 moves them here so sticky notes and free
 * text objects share one implementation: a pasted value is cut to an explicit
 * limit without ever splitting a surrogate pair, and a `Y.Text` is updated with
 * the smallest change (common prefix + common suffix) rather than a full
 * replace, which is what keeps concurrent typing safe once a board syncs.
 *
 * `StickyText.ts` re-exports these with `STICKY_TEXT_MAX_CHARS` as the default
 * limit, so the story-2 callers and unit tests are unchanged.
 */
import * as Y from 'yjs';

/** Cut a value at `max`, never in the middle of a surrogate pair. */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  let cut = max;
  // Do not leave a lone high surrogate at the end (would split a pair).
  const before = next.charCodeAt(cut - 1);
  if (before >= 0xd800 && before <= 0xdbff) cut -= 1;
  return next.slice(0, cut);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** Back an index off a split surrogate pair (index sitting between the two units). */
function snapBack(text: string, index: number): number {
  if (index > 0 && index < text.length && isHighSurrogate(text.charCodeAt(index - 1))) {
    return index - 1;
  }
  return index;
}

/**
 * Apply `next` to a `Y.Text` with the smallest change: one delete and/or one
 * insert covering only the differing middle. A no-op (`current === next`) opens
 * no transaction. Safe under concurrent edits, unlike a full replace.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  const doc = ytext.doc;
  if (!doc) {
    // Detached text (only happens in isolated unit tests): still make it correct.
    ytext.delete(0, current.length);
    if (next.length > 0) ytext.insert(0, next);
    return;
  }
  const minLen = Math.min(current.length, next.length);

  let start = 0;
  while (start < minLen && current.charCodeAt(start) === next.charCodeAt(start)) start += 1;

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

  // Keep surrogate pairs whole at both edges of the changed middle.
  start = snapBack(current, start);
  start = snapBack(next, start);
  endCurrent = snapBack(current, endCurrent);
  endNext = snapBack(next, endNext);

  const deleteLength = endCurrent - start;
  const inserted = next.slice(start, endNext);

  doc.transact(() => {
    if (deleteLength > 0) ytext.delete(start, deleteLength);
    if (inserted.length > 0) ytext.insert(start, inserted);
  }, origin);
}