import * as Y from 'yjs';

import { LOCAL_ORIGIN, objectOf } from '../../../src/shared/board-model';
import type { Measurer } from '../../../src/client/objects/textLayout';

export { readObjectEntry, seedText, textIdsOf } from '../../unit/helpers/text';

/**
 * The fake measurer the story 9 component tests share: 10 board units to a
 * character at size M, so a box can be asserted to the unit. The layout itself
 * is pinned in `tests/unit/text-layout.test.ts`; here it is only the reason a
 * measured box is predictable.
 */
export const fakeMeasurer: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

/** Counts the box writes one text object has seen from this client. */
export interface BoxWrites {
  /** Writes that touched `width` or `height` — including a gesture's own width write. */
  count(): number;
  /** Writes that carried a `height`: the ones only a re-measure can be. */
  heights(): number;
  reset(): void;
}

/**
 * Counts the times *this client* wrote a text object's `width`/`height` — the
 * thing `useTextBoxSync` is judged on: one write when its own change asked for
 * one, and none when the change came from somebody else, however different the
 * box on this screen would have been.
 *
 * A "write" is one transaction that touched either key, so a helper that wrote
 * a box in three passes would read as three writes.
 */
export function watchBoxWrites(doc: Y.Doc, id: string): BoxWrites {
  let writes = 0;
  let heightWrites = 0;
  const entry = objectOf(doc, id);
  const observer = (event: Y.YMapEvent<unknown>): void => {
    if (event.transaction.origin !== LOCAL_ORIGIN) return;
    if (event.keys.has('width') || event.keys.has('height')) writes += 1;
    if (event.keys.has('height')) heightWrites += 1;
  };
  entry?.observe(observer);
  return {
    count: () => writes,
    heights: () => heightWrites,
    reset: () => {
      writes = 0;
      heightWrites = 0;
    },
  };
}
