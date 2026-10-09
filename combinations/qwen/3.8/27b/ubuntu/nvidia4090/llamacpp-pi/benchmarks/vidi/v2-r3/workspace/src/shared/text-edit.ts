/**
 * Story 9 (text.model): shared Y.Text editing helpers.
 *
 * Moved here from src/client/objects/StickyText.ts (story 2) so sticky notes
 * and text objects share them; StickyText re-exports both.
 */
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from './board-model';

/** Keeps at most `max` characters. */
export function clampToLimit(next: string, max: number): string {
  return next.length > max ? next.slice(0, max) : next;
}

/**
 * Apply the minimal change (common prefix + common suffix) from the current
 * text to `next` on the Y.Text, in one transaction under `origin`. This is
 * what keeps concurrent typing by others intact (story 3).
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown = LOCAL_ORIGIN): void {
  const cur = ytext.toString();
  if (cur === next) return;
  let start = 0;
  const minLen = Math.min(cur.length, next.length);
  while (start < minLen && cur[start] === next[start]) start++;
  let endCur = cur.length;
  let endNext = next.length;
  while (endCur > start && endNext > start && cur[endCur - 1] === next[endNext - 1]) {
    endCur--;
    endNext--;
  }
  const doc = ytext.doc;
  if (doc) {
    doc.transact(
      () => {
        ytext.delete(start, endCur - start);
        if (endNext > start) ytext.insert(start, next.slice(start, endNext));
      },
      origin,
    );
  } else {
    ytext.delete(start, endCur - start);
    if (endNext > start) ytext.insert(start, next.slice(start, endNext));
  }
}
