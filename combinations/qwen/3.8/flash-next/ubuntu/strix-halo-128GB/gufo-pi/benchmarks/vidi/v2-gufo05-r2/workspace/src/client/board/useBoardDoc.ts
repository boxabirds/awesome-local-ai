import { useCallback, useMemo, useSyncExternalStore } from 'react';
import * as Y from 'yjs';

import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface BoardDoc {
  readonly doc: Y.Doc;
  readonly notes: readonly StickySnapshot[];
}

/**
 * Owns the single in-memory `Y.Doc` for this page, keeps it initialised, and
 * exposes an immutable `StickySnapshot[]` recomputed whenever the objects
 * change (`observeDeep`). Story 3 attaches a network provider to the same doc;
 * story 4 persists it — no component changes are needed then.
 */
export function useBoardDoc(): BoardDoc {
  const doc = useMemo(() => {
    const next = new Y.Doc();
    initDoc(next);
    return next;
  }, []);

  // The snapshot is recomputed only when the objects map changes. `subscribe`
  // wires observeDeep; `getSnapshot` returns the cached value so React only
  // re-renders when the snapshot reference actually changes.
  const store = useMemo(() => {
    let current = snapshot(doc);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const listeners = new Set<() => void>();
    const emit = () => {
      current = snapshot(doc);
      for (const listener of listeners) listener();
    };
    return {
      subscribe(listener: () => void): () => void {
        if (listeners.size === 0) objects.observeDeep(emit);
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
          if (listeners.size === 0) objects.unobserveDeep(emit);
        };
      },
      getSnapshot: () => current,
    };
  }, [doc]);

  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { doc, notes };
}
