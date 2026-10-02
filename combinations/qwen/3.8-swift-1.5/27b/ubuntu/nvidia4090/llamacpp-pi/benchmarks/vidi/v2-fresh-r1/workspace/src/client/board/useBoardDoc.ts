// React hook that owns the Y.Doc and exposes an immutable snapshot
// via useSyncExternalStore. Story 3 will attach a network provider here.

import { useCallback, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export function useBoardDoc(): { doc: Y.Doc; objects: readonly StickySnapshot[] } {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  // Cache the snapshot so getSnapshot returns a stable reference
  // when the doc hasn't changed (prevents infinite re-render loops).
  const snapshotCacheRef = useRef<{ dirty: boolean; value: readonly StickySnapshot[] }>({
    dirty: true,
    value: [],
  });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        snapshotCacheRef.current.dirty = true;
        onStoreChange();
      };
      objects.observeDeep(handler);
      return () => {
        objects.unobserveDeep(handler);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback(() => {
    if (snapshotCacheRef.current.dirty) {
      snapshotCacheRef.current.value = snapshot(doc);
      snapshotCacheRef.current.dirty = false;
    }
    return snapshotCacheRef.current.value;
  }, [doc]);

  const objects = useSyncExternalStore(subscribe, getSnapshot);

  return { doc, objects };
}
