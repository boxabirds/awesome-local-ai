import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface BoardDocState {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
}

/**
 * Owns a single Y.Doc, subscribes to deep changes on `objects`,
 * and exposes an immutable snapshot via useSyncExternalStore.
 */
export function useBoardDoc(): BoardDocState {
  const doc = useMemo(() => {
    const d = new Y.Doc();
    initDoc(d);
    return d;
  }, []);

  const objectsMap = useMemo(
    () => doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>,
    [doc],
  );

  const snapRef = useRef<readonly StickySnapshot[]>(snapshot(doc));

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const observer = () => {
        snapRef.current = snapshot(doc);
        onStoreChange();
      };
      objectsMap.observeDeep(observer);
      return () => {
        objectsMap.unobserveDeep(observer);
      };
    },
    [doc, objectsMap],
  );

  const getSnapshot = useCallback(() => snapRef.current, []);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { doc, notes };
}
