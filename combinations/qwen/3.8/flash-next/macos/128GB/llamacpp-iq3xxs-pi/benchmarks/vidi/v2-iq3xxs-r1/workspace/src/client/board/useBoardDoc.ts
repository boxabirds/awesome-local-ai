import { useCallback, useMemo, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import {
  initDoc,
  snapshot,
  OBJECTS_MAP,
  type StickySnapshot,
} from '../../shared/board-model';

export interface BoardDoc {
  readonly doc: Y.Doc;
  /** Sticky notes in paint order; a new array only when the document changed. */
  readonly notes: readonly StickySnapshot[];
}

/**
 * Owns this page's `Y.Doc` (in memory only in story 2; story 3 attaches a
 * network provider to the same document, story 4 persists it) and exposes an
 * immutable snapshot of it to React through `useSyncExternalStore`, so renders
 * are driven by `observeDeep` rather than by component state.
 */
export function useBoardDoc(): BoardDoc {
  const doc = useMemo(() => {
    const next = new Y.Doc();
    initDoc(next);
    return next;
  }, []);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
      const changed = () => onStoreChange();
      objects.observeDeep(changed);
      return () => objects.unobserveDeep(changed);
    },
    [doc],
  );

  // `snapshot` is recomputed only when the document actually changed, and the
  // previous array is kept while nothing changed (the contract useSyncExternalStore
  // requires for getSnapshot).
  const cache = useMemo(() => {
    let current: readonly StickySnapshot[] = snapshot(doc);
    return {
      read(): readonly StickySnapshot[] {
        return current;
      },
      refresh(): void {
        current = snapshot(doc);
      },
    };
  }, [doc]);

  const getSnapshot = useCallback(() => cache.read(), [cache]);
  // Refresh the cached snapshot inside the subscription so the value returned by
  // getSnapshot is always up to date (and identical between changes).
  const subscribeAndRefresh = useCallback(
    (onStoreChange: () => void) =>
      subscribe(() => {
        cache.refresh();
        onStoreChange();
      }),
    [subscribe, cache],
  );

  const notes = useSyncExternalStore(
    subscribeAndRefresh,
    getSnapshot,
    getSnapshot,
  );

  return { doc, notes };
}
