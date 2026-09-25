import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '@/shared/board-model';

export interface BoardDoc {
  /** The in-memory Yjs document (story 3 attaches a provider, story 4 persists it). */
  doc: Y.Doc;
  /** Immutable snapshot of all sticky notes, sorted by (z, id). */
  notes: readonly StickySnapshot[];
}

/**
 * Owns the board's Y.Doc for this page and exposes an immutable snapshot via
 * useSyncExternalStore. The snapshot is recomputed only when the `objects`
 * map changes (observeDeep), and getSnapshot returns a cached reference in
 * between, as required by useSyncExternalStore.
 */
export function useBoardDoc(): BoardDoc {
  const [doc] = useState<Y.Doc>(() => {
    const d = new Y.Doc();
    initDoc(d);
    return d;
  });

  const cacheRef = useRef<readonly StickySnapshot[] | null>(null);

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    if (cacheRef.current === null) {
      cacheRef.current = snapshot(doc);
    }
    return cacheRef.current;
  }, [doc]);

  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        cacheRef.current = snapshot(doc);
        onStoreChange();
      };
      objects.observeDeep(handler);
      return () => {
        objects.unobserveDeep(handler);
      };
    },
    [doc],
  );

  const notes = useSyncExternalStore(subscribe, getSnapshot);
  return { doc, notes };
}
