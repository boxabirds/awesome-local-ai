/**
 * Shared text-editing logic for text-carrying objects (story 9; extracted
 * from the story 2 sticky editor so both sticky notes and free text use the
 * same rules). Pure Yjs, no React.
 *
 * The client re-exports these from `src/client/objects/StickyText.ts`, so
 * story 2 callers and tests are unchanged.
 */

import type * as Y from 'yjs';

/**
 * Keeps at most `max` characters; characters beyond the limit are dropped.
 */
export function clampToLimit(next: string, max: number): string {
  return next.length > max ? next.slice(0, max) : next;
}

/**
 * Applies the minimal change (common prefix + common suffix) that turns the
 * Y.Text's current content into `next`: at most one delete and one insert in
 * a single transaction. Never a full replace, so concurrent typing by others
 * (story 3) is never destroyed. Surrogate-pair safe: a boundary that would
 * split an emoji is pulled so the whole pair is on one side of the change.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const cur = ytext.toString();
  if (cur === next) {
    return; // no change: no transaction, no event
  }

  const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
  const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

  const minLen = Math.min(cur.length, next.length);

  // Common prefix (code units).
  let prefix = 0;
  while (prefix < minLen && cur.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix++;
  }
  // If the prefix boundary falls in the middle of a surrogate pair, the pair
  // is not fully common: pull the whole pair into the changed region.
  if (
    prefix > 0 &&
    prefix < cur.length &&
    isHigh(cur.charCodeAt(prefix - 1)) &&
    isLow(cur.charCodeAt(prefix))
  ) {
    prefix--;
  }

  // Common suffix (code units), not overlapping the prefix.
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    cur.charCodeAt(cur.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++;
  }
  // If the suffix boundary falls in the middle of a surrogate pair, keep the
  // whole pair in the changed region (the suffix shrinks by one unit).
  const suffixStart = cur.length - suffix;
  if (
    suffixStart > 0 &&
    suffixStart < cur.length &&
    isHigh(cur.charCodeAt(suffixStart - 1)) &&
    isLow(cur.charCodeAt(suffixStart))
  ) {
    suffix--;
  }

  const deleteLen = cur.length - prefix - suffix;
  const insert = next.slice(prefix, next.length - suffix);

  const apply = (): void => {
    if (deleteLen > 0) {
      ytext.delete(prefix, deleteLen);
    }
    if (insert.length > 0) {
      ytext.insert(prefix, insert);
    }
  };

  const doc = ytext.doc;
  if (doc === null) {
    // A Y.Text not yet attached to a document (unit-level use): apply directly.
    apply();
    return;
  }
  // One transaction per edit, tagged with the caller's origin.
  doc.transact(apply, origin);
}
