import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

/**
 * Owns the board document and turns it into an immutable React model.
 *
 * The Y.Doc is the only copy of the board in this story; story 3 attaches a
 * network provider to the same document and story 4 persists it, which is why
 * nothing here knows about fetching or saving.
 */

export interface BoardDocState {
  readonly doc: Y.Doc;
  /** Notes in draw order (z, then id). Recomputed only when the doc changes. */
  readonly notes: readonly StickySnapshot[];
}

/** A fresh board document, tagged with the schema version. */
export function createBoardDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/**
 * `useBoardDoc()` creates the document; passing one in lets a caller (tests, or
 * story 3's provider) supply an already filled document.
 */
export function useBoardDoc(provided?: Y.Doc): BoardDocState {
  const [doc] = useState(() => provided ?? createBoardDoc());

  // The snapshot is memoised between changes so `useSyncExternalStore` sees a
  // stable reference and React does not re-render in a loop.
  const cacheRef = useRef<readonly StickySnapshot[] | null>(null);

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    const cached = cacheRef.current;
    if (cached !== null) {
      return cached;
    }
    const next = snapshot(doc);
    cacheRef.current = next;
    return next;
  }, [doc]);

  const subscribe = useCallback(
    (onChange: () => void): (() => void) => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const handler = (): void => {
        cacheRef.current = null;
        onChange();
      };
      objects.observeDeep(handler);
      cacheRef.current = null;
      return () => {
        objects.unobserveDeep(handler);
      };
    },
    [doc],
  );

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { doc, notes };
}
