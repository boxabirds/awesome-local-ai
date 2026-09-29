import { useRef, useSyncExternalStore, useCallback } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '@shared/board-model';

export function useBoardDoc(): { doc: Y.Doc; objects: readonly StickySnapshot[] } {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  // Cache the snapshot to maintain referential equality for useSyncExternalStore
  const snapshotRef = useRef<readonly StickySnapshot[]>(snapshot(doc));

  const subscribe = useCallback((callback: () => void) => {
    const objects = doc.getMap('objects');
    const observer = () => {
      snapshotRef.current = snapshot(doc);
      callback();
    };
    objects.observeDeep(observer);
    return () => {
      objects.unobserveDeep(observer);
    };
  }, [doc]);

  const getSnapshot = useCallback(() => {
    return snapshotRef.current;
  }, []);

  const objects = useSyncExternalStore(subscribe, getSnapshot);

  return { doc, objects };
}
