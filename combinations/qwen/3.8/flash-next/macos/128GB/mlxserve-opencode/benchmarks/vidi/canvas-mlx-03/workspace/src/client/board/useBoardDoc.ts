import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import {
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../shared/board-model.ts';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
}

/**
 * Owns one Y.Doc, initialises its schema, and exposes an immutable sticky-note
 * snapshot through useSyncExternalStore. The snapshot is memoised and only
 * recomputed when the objects map (deep) changes. Story 3 attaches a network
 * provider to the same doc; story 4 persists it — no change needed here.
 *
 * `injected` lets component tests supply their own document (defaults to a fresh
 * one so production code calls `useBoardDoc()` with no arguments).
 */
export function useBoardDoc(injected?: Y.Doc): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) docRef.current = injected ?? new Y.Doc();
  const doc = docRef.current;

  const cacheRef = useRef<readonly StickySnapshot[]>(snapshot(doc));

  useEffect(() => {
    initDoc(doc);
    // Schema may have just been written; refresh the cache.
    cacheRef.current = snapshot(doc);
  }, [doc]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
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

  const getSnapshot = useCallback(() => cacheRef.current, []);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { doc, notes };
}
