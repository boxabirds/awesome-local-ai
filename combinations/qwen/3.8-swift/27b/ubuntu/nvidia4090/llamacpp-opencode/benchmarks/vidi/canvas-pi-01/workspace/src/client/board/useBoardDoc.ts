// Owns the in-memory Y.Doc and exposes an immutable note snapshot to React
// via useSyncExternalStore (see spec: board.model — "snapshot is memoised by
// useBoardDoc and recomputed on objects.observeDeep"). Story 3 attaches a
// network provider to the same document; story 4 persists it.

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
  const cacheRef = useRef<{ notes: readonly StickySnapshot[] } | null>(null);

  const getSnapshot = useCallback(() => {
    if (cacheRef.current === null) cacheRef.current = { notes: snapshot(doc) };
    return cacheRef.current.notes;
  }, [doc]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        cacheRef.current = { notes: snapshot(doc) };
        onStoreChange();
      };
      objects.observeDeep(handler);
      return () => objects.unobserveDeep(handler);
    },
    [doc],
  );

  return { doc, notes: useSyncExternalStore(subscribe, getSnapshot) };
}
