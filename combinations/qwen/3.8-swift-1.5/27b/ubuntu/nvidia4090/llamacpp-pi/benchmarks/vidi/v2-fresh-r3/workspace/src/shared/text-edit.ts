import * as Y from 'yjs';
import { LOCAL_ORIGIN } from './board-model';

/**
 * Shared text-edit helpers (story 9). `clampToLimit` and `applyTextDiff` were
 * moved here from `src/client/objects/StickyText.ts` (story 2) so sticky
 * notes and free text share them; `StickyText.ts` re-exports both.
 */

/** Keeps at most `max` characters. */
export function clampToLimit(next: string, max: number): string {
  return next.length > max ? next.slice(0, max) : next;
}

/**
 * Applies the minimal change (common prefix + common suffix) from the
 * Y.Text's current value to `next`: at most one delete and one insert, in a
 * single transaction. Surrogate-pair safe. A no-op when the values are
 * equal (no transaction, no delta events), so concurrent typing by others
 * (story 3) is never destroyed by a full replace.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown = LOCAL_ORIGIN): void {
  const current = ytext.toString();
  if (current === next) return;

  const lenCurrent = current.length;
  const lenNext = next.length;

  // Common prefix
  let start = 0;
  while (start < lenCurrent && start < lenNext && current.charCodeAt(start) === next.charCodeAt(start)) {
    start++;
  }
  // Common suffix (must not overlap the prefix)
  let endCurrent = lenCurrent;
  let endNext = lenNext;
  while (
    endCurrent > start &&
    endNext > start &&
    current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)
  ) {
    endCurrent--;
    endNext--;
  }

  // `transact` exists at runtime on every AbstractType (it is a no-doc
  // passthrough for standalone Y.Text) but is missing from yjs's d.ts.
  const apply = () => {
    if (endCurrent > start) {
      ytext.delete(start, endCurrent - start);
    }
    if (endNext > start) {
      ytext.insert(start, next.slice(start, endNext));
    }
  };

  const doc = ytext.doc;
  if (doc) {
    doc.transact(apply, origin);
  } else {
    // Detached Y.Text (only possible outside a document): apply without a
    // transaction. In the app the text always lives in an object in the doc.
    apply();
  }
}
