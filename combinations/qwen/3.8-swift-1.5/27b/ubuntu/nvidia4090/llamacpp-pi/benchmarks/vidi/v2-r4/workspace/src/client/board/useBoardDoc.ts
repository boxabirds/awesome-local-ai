import { useRef, useSyncExternalStore, useCallback } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export function useBoardDoc(): { doc: Y.Doc; notes: readonly StickySnapshot[] } {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    docRef.current = new Y.Doc();
    initDoc(docRef.current);
  }
  const doc = docRef.current;

  const subscribe = useCallback(
    (callback: () => void) => {
      const objects = doc.getMap('objects');
      objects.observeDeep(callback);
      return () => objects.unobserveDeep(callback);
    },
    [doc],
  );

  const getSnapshot = useCallback(() => {
    return snapshot(doc);
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot);

  return { doc, notes };
}
