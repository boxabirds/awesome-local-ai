import * as Y from 'yjs';

/**
 * Shared plain-text editing helpers (story 9, text.editing). Story 2's sticky
 * note editor and story 9's free text objects both commit edits through these
 * two functions so the Y.Text diffing stays in one place.
 */

/** Keeps at most `max` characters (text.limit: extras are never added). */
export function clampToLimit(next: string, max: number): string {
  return next.length > max ? next.slice(0, max) : next;
}

/**
 * Applies the minimal change (common prefix + common suffix) that turns the
 * Y.Text's current value into `next`: at most one delete and at most one
 * insert, inside a single transaction. A full replace would destroy
 * concurrent typing by other clients once story 3 ships, so the minimal
 * diff is required. Surrogate pairs are never split: the delete/insert
 * boundaries always fall on the common prefix/suffix, which align with
 * identical code units in both strings.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  const minLen = Math.min(current.length, next.length);
  let prefix = 0;
  while (prefix < minLen && current[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < minLen - prefix && current[current.length - 1 - suffix] === next[next.length - 1 - suffix]) {
    suffix += 1;
  }
  const deleteLength = current.length - prefix - suffix;
  const insertText = next.slice(prefix, next.length - suffix);
  const apply = () => {
    if (deleteLength > 0) ytext.delete(prefix, deleteLength);
    if (insertText.length > 0) ytext.insert(prefix, insertText);
  };
  const doc = ytext.doc;
  if (doc) {
    doc.transact(apply, origin);
  } else {
    // Standalone (unattached) Y.Text: no document to transact on.
    apply();
  }
}
