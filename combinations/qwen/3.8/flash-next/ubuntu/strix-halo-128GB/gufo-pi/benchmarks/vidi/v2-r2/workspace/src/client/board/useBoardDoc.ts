import { useMemo, useSyncExternalStore, useRef } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '@shared/board-model';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
}

export function useBoardDoc(): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (!docRef.current) {
    docRef.current = new Y.Doc();
    initDoc(docRef.current);
  }
  const doc = docRef.current;

  const cacheRef = useRef<readonly StickySnapshot[]>([]);

  const subscribe = useMemo(() => {
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    return (onStoreChange: () => void) => {
      const observer = () => {
        cacheRef.current = snapshot(doc);
        onStoreChange();
      };
      objects.observeDeep(observer);
      // Initial snapshot
      cacheRef.current = snapshot(doc);
      return () => {
        objects.unobserveDeep(observer);
      };
    };
  }, [doc]);

  const getSnapshot = useMemo(() => {
    // Initialize on first call
    cacheRef.current = snapshot(doc);
    return () => cacheRef.current;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot);

  return { doc, notes };
}
