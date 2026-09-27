import { useCallback, useRef, useSyncExternalStore } from 'react';
import { Doc } from 'yjs';

import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface BoardDoc {
  /** The single in-memory document. Story 3 attaches a provider to this. */
  doc: Doc;
  /** Sticky notes in render order `(z, id)`; immutable, memoised snapshot. */
  notes: readonly StickySnapshot[];
}

/**
 * Owns one `Y.Doc` for the board and exposes an immutable snapshot of its
 * notes through `useSyncExternalStore`. The snapshot is recomputed only when
 * the `objects` map (or anything under it) changes, so React re-renders on real
 * edits and never tears mid-transaction (Yjs fires observers after a
 * transaction commits).
 *
 * No provider and no persistence in this story — this is the seam stories 3 and
 * 4 plug into.
 */
export function useBoardDoc(): BoardDoc {
  const docRef = useRef<Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  // The value handed to useSyncExternalStore must be referentially stable
  // between store changes, so it lives in a ref and is only rebuilt in the
  // observer, never on an unrelated render.
  const cacheRef = useRef<readonly StickySnapshot[]>(snapshot(doc));

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        cacheRef.current = snapshot(doc);
        onStoreChange();
      };
      objects.observeDeep(handler);
      return () => objects.unobserveDeep(handler);
    },
    [doc],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => cacheRef.current, []);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { doc, notes };
}
