import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
}

const EMPTY_NOTES: readonly StickySnapshot[] = [];

// Owns the single local Y.Doc for this page. Story 3 attaches a network
// provider to the same doc; story 4 persists it. The snapshot is recomputed
// only when the objects map changes (observeDeep) and shared via
// useSyncExternalStore. An existing doc can be supplied (tests).
export function useBoardDoc(provided?: Y.Doc): BoardDoc {
  const docRef = useRef<Y.Doc | null>(provided ?? null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const cacheRef = useRef<{ revision: number; notes: readonly StickySnapshot[] } | null>(
    null
  );
  if (cacheRef.current === null) {
    cacheRef.current = { revision: 0, notes: snapshot(doc) };
  }

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');
      const observer = () => {
        const prev = cacheRef.current;
        cacheRef.current = {
          revision: (prev?.revision ?? 0) + 1,
          notes: snapshot(doc)
        };
        onStoreChange();
      };
      objects.observeDeep(observer);
      return () => objects.unobserveDeep(observer);
    },
    [doc]
  );

  const getSnapshot = useCallback(() => cacheRef.current?.notes ?? EMPTY_NOTES, []);
  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo(() => ({ doc, notes }), [doc, notes]);
}
