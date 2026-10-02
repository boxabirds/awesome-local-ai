import { useCallback, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { OBJECTS_MAP_NAME, initDoc, snapshot } from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';

export interface BoardDocStore {
  /** The Yjs document holding the board (story 3 attaches a provider to it). */
  doc: Y.Doc;
  /** Immutable render model, sorted by (z, id); recomputed only when the doc changes. */
  notes: readonly StickySnapshot[];
}

interface Store {
  doc: Y.Doc;
  /** Bumped by every observed doc change. */
  rev: number;
  /** Revision the memoised snapshot below was computed at. */
  cacheRev: number;
  value: readonly StickySnapshot[] | null;
}

/**
 * Owns one local Y.Doc and exposes it plus an immutable snapshot of its objects
 * through useSyncExternalStore. No network and no storage in story 2.
 */
export function useBoardDoc(): BoardDocStore {
  const ref = useRef<Store | null>(null);
  if (ref.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    ref.current = { doc, rev: 0, cacheRev: -1, value: null };
  }
  const store = ref.current;
  const doc = store.doc;

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap(OBJECTS_MAP_NAME);
      const observer = () => {
        store.rev += 1;
        onStoreChange();
      };
      objects.observeDeep(observer);
      return () => objects.unobserveDeep(observer);
    },
    [doc, store],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    if (store.value === null || store.cacheRev !== store.rev) {
      store.cacheRev = store.rev;
      store.value = snapshot(doc);
    }
    return store.value;
  }, [doc, store]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { doc, notes };
}
