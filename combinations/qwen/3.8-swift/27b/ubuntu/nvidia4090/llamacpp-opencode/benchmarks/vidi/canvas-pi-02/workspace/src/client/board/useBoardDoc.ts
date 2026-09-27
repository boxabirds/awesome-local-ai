// Owns the in-memory Y.Doc (the board's source of truth from day one, so
// story 3 only attaches a provider and story 4 only persists) and exposes
// an immutable snapshot of the objects to React via useSyncExternalStore.

import { useCallback, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface Board {
  /** The live Y.Doc (never shared across components; story 3 attaches a provider). */
  doc: Y.Doc;
  /** Immutable sticky-note snapshots, sorted by (z, id). Stable reference
   *  between document changes. */
  notes: readonly StickySnapshot[];
}

export function useBoardDoc(): Board {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  // The snapshot is recomputed exactly once per document change (inside the
  // observeDeep callback) and stays the same reference until the next change,
  // as useSyncExternalStore requires.
  const cacheRef = useRef<readonly StickySnapshot[]>(snapshot(doc));

  const subscribe = useCallback(
    (onChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = (): void => {
        cacheRef.current = snapshot(doc);
        onChange();
      };
      objects.observeDeep(handler);
      return () => objects.unobserveDeep(handler);
    },
    [doc],
  );

  const getSnapshot = useCallback(() => cacheRef.current, [doc]);
  const notes = useSyncExternalStore(subscribe, getSnapshot);

  return { doc, notes };
}
