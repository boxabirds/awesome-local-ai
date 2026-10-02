import { useRef, useSyncExternalStore, useCallback } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export function useBoardDoc(): { doc: Y.Doc; snapshots: readonly StickySnapshot[] } {
  const docRef = useRef<Y.Doc | null>(null);
  if (!docRef.current) {
    docRef.current = new Y.Doc();
    initDoc(docRef.current);
  }
  const doc = docRef.current;

  const snapshotsRef = useRef<readonly StickySnapshot[]>(snapshot(doc));
  const listenersRef = useRef<Set<() => void>>(new Set());

  // Subscribe to deep changes on the objects map
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');

      const handler = () => {
        snapshotsRef.current = snapshot(doc);
        listenersRef.current.forEach((listener) => listener());
      };

      objects.observeDeep(handler);
      listenersRef.current.add(onStoreChange);

      return () => {
        objects.unobserveDeep(handler);
        listenersRef.current.delete(onStoreChange);
      };
    },
    [doc]
  );

  const getSnapshot = useCallback(() => {
    return snapshotsRef.current;
  }, []);

  const snapshots = useSyncExternalStore(subscribe, getSnapshot);

  return { doc, snapshots };
}
