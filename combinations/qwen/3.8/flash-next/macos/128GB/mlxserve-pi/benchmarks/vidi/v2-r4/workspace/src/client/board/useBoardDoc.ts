import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';

import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface BoardDoc {
  /** The document this client owns. Story 3 attaches a network provider to it. */
  doc: Y.Doc;
  /** Immutable snapshot of every known object, sorted for painting. */
  notes: readonly StickySnapshot[];
}

/**
 * Owns the board's `Y.Doc` and republishes `snapshot()` as a React store.
 *
 * The snapshot is memoised: `objects.observeDeep` marks it dirty and the next
 * `getSnapshot` recomputes it once, so `useSyncExternalStore` always compares
 * stable references and only re-renders when the document actually changed.
 * Observing with `observeDeep` (rather than `observe`) is what makes changes
 * inside a note — its `Y.Text`, its colour — visible here, which is exactly the
 * subscription story 3 needs for remote edits.
 */
export function useBoardDoc(existing?: Y.Doc): BoardDoc {
  const doc = useMemo(() => {
    const created = existing ?? new Y.Doc();
    initDoc(created);
    return created;
  }, [existing]);

  // Wrapped in an object so "not computed" is distinguishable from a snapshot
  // of no notes.
  const cache = useRef<{ value: readonly StickySnapshot[] } | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const observer = () => {
        cache.current = null;
        onStoreChange();
      };
      objects.observeDeep(observer);
      return () => objects.unobserveDeep(observer);
    },
    [doc],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    if (cache.current === null) cache.current = { value: snapshot(doc) };
    return cache.current.value;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo(() => ({ doc, notes }), [doc, notes]);
}
