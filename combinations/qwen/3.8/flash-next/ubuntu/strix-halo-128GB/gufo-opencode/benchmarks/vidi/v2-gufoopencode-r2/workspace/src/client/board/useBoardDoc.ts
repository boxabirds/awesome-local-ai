// Owns the single in-memory Y.Doc for this page and exposes an immutable
// snapshot of the board objects via useSyncExternalStore. Story 3 attaches a
// network provider to this same doc; story 4 persists it.

import { useCallback, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
}

export function useBoardDoc(): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const snapRef = useRef<readonly StickySnapshot[]>(snapshot(doc));
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const observer = () => {
        snapRef.current = snapshot(doc);
        onStoreChange();
      };
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      objects.observeDeep(observer);
      // Recompute in case a mutation landed between render and subscribe.
      snapRef.current = snapshot(doc);
      return () => objects.unobserveDeep(observer);
    },
    [doc],
  );
  const getSnapshot = useCallback(() => snapRef.current, []);
  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { doc, notes };
}
