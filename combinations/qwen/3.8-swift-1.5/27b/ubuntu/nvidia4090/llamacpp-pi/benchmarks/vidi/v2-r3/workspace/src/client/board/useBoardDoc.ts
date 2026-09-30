import { useRef, useCallback, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

/**
 * Owns the in-memory `Y.Doc` for the board and exposes an immutable snapshot
 * of the objects via `useSyncExternalStore`. Story 3 attaches a network
 * provider to this same doc; story 4 persists it. No network or storage here.
 */
export function useBoardDoc(): { doc: Y.Doc; notes: readonly StickySnapshot[] } {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  // The snapshot is recomputed only on document changes and cached, so
  // getSnapshot returns a stable reference until something mutates the doc.
  const cacheRef = useRef<readonly StickySnapshot[] | null>(null);
  if (cacheRef.current === null) {
    cacheRef.current = snapshot(doc);
  }

  const subscribe = useCallback(
    (onChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        cacheRef.current = snapshot(doc);
        onChange();
      };
      objects.observeDeep(handler);
      return () => {
        objects.unobserveDeep(handler);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback(() => cacheRef.current as readonly StickySnapshot[], [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot);
  return { doc, notes };
}
