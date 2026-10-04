import { useRef, useSyncExternalStore, useCallback } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

/**
 * Owns the Y.Doc and exposes an immutable snapshot via useSyncExternalStore.
 * Uses a version counter to provide a stable getSnapshot reference.
 */
export function useBoardDoc(): { doc: Y.Doc; notes: readonly StickySnapshot[] } {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    docRef.current = new Y.Doc();
    initDoc(docRef.current);
  }
  const doc = docRef.current;

  // We need a mutable ref to hold the current snapshot, updated by the observer.
  // useSyncExternalStore requires getSnapshot to return a cached value.
  const stateRef = useRef<{ notes: readonly StickySnapshot[] }>({
    notes: snapshot(doc),
  });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        stateRef.current.notes = snapshot(doc);
        onStoreChange();
      };
      objects.observeDeep(handler);
      return () => objects.unobserveDeep(handler);
    },
    [doc],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    return stateRef.current.notes;
  }, []);

  const notes = useSyncExternalStore(subscribe, getSnapshot);

  return { doc, notes };
}
