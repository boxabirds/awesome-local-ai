import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface UseBoardDocResult {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
}

/**
 * Owns a single in-memory Y.Doc for this page, initialises the schema, and
 * exposes an immutable snapshot of the sticky notes that is recomputed only
 * when the objects map changes. Story 3 attaches a network provider to `doc`;
 * story 4 persists the same document — the note data survives because it all
 * lives in the Y.Doc, not in React state.
 */
export function useBoardDoc(): UseBoardDocResult {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const cache = useRef<{ snapshot: readonly StickySnapshot[] }>({
    snapshot: snapshot(doc),
  });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');
      const observer = () => {
        // Recompute before notifying so getSnapshot returns fresh data.
        cache.current = { snapshot: snapshot(doc) };
        onStoreChange();
      };
      objects.observeDeep(observer);
      return () => objects.unobserveDeep(observer);
    },
    [doc],
  );

  const getSnapshot = useCallback(() => cache.current.snapshot, []);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo(() => ({ doc, notes }), [doc, notes]);
}
