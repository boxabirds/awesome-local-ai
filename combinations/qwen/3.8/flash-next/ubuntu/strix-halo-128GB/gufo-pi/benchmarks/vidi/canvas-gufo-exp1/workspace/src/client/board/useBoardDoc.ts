/**
 * Owns the board's `Y.Doc` and exposes an immutable snapshot of its objects to
 * React via `useSyncExternalStore`.
 *
 * The doc lives for the lifetime of the mounted board. Story 3 attaches a network
 * provider to this same doc and story 4 persists it; nothing else has to change.
 */
import { useCallback, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface BoardDoc {
  readonly doc: Y.Doc;
  readonly notes: readonly StickySnapshot[];
}

export function useBoardDoc(): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  // The snapshot must be referentially stable between changes, so it is cached and
  // only recomputed when the document actually updates.
  const cacheRef = useRef<readonly StickySnapshot[]>(snapshot(doc));

  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      const objects = doc.getMap('objects');
      const observer = (): void => {
        cacheRef.current = snapshot(doc);
        onStoreChange();
      };
      objects.observeDeep(observer);
      // Pick up any mutation that happened between render and subscribe.
      const next = snapshot(doc);
      if (next !== cacheRef.current) {
        cacheRef.current = next;
        onStoreChange();
      }
      return () => objects.unobserveDeep(observer);
    },
    [doc],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => cacheRef.current, []);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { doc, notes };
}
