import { useCallback, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface UseBoardDoc {
  /** The in-memory Y.Doc. Story 3 attaches a network provider; story 4 persists it. */
  doc: Y.Doc;
  /** Immutable snapshot of all sticky notes, sorted by (z, id). */
  stickies: readonly StickySnapshot[];
}

/**
 * Owns the board's Y.Doc and exposes an immutable snapshot of its sticky
 * notes via useSyncExternalStore. The snapshot is recomputed on
 * `objects.observeDeep` (which also fires for Y.Text edits inside notes)
 * and memoised so getSnapshot returns a stable reference between updates.
 */
export function useBoardDoc(): UseBoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const stateRef = useRef<{ snap: readonly StickySnapshot[] }>({ snap: snapshot(doc) });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        stateRef.current = { snap: snapshot(doc) };
        onStoreChange();
      };
      objects.observeDeep(handler);
      return () => {
        objects.unobserveDeep(handler);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback(() => stateRef.current.snap, []);

  const stickies = useSyncExternalStore(subscribe, getSnapshot);

  return { doc, stickies };
}
