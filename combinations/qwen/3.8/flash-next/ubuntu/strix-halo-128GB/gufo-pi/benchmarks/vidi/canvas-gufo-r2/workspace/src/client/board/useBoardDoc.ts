/**
 * Owns the Y.Doc, exposes an immutable snapshot via useSyncExternalStore.
 * Story 3 adds a network provider; story 4 adds persistence.
 *
 * The snapshot array is memoised: useSyncExternalStore requires getSnapshot to
 * return a stable reference when nothing has changed, otherwise React loops.
 */
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface BoardDocState {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
}

/** Create a board doc (optionally inject one for tests). */
export function makeBoardDoc(injected?: Y.Doc): Y.Doc {
  const d = injected ?? new Y.Doc();
  initDoc(d);
  return d;
}

export function useBoardDoc(injectedDoc?: Y.Doc): BoardDocState {
  // Create a single Y.Doc instance that persists across renders.
  const doc = useMemo(() => {
    return makeBoardDoc(injectedDoc);
  }, [injectedDoc]);

  // Cached snapshot: recomputed only when the doc's objects map changes.
  const cacheRef = useRef<{ doc: Y.Doc; value: readonly StickySnapshot[] } | null>(null);

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    const cached = cacheRef.current;
    if (cached && cached.doc === doc) return cached.value;
    const value = snapshot(doc);
    cacheRef.current = { doc, value };
    return value;
  }, [doc]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');
      const observer = () => {
        // Invalidate cache so getSnapshot recomputes on next read.
        cacheRef.current = null;
        onStoreChange();
      };
      objects.observeDeep(observer);
      return () => objects.unobserveDeep(observer);
    },
    [doc],
  );

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { doc, notes };
}
