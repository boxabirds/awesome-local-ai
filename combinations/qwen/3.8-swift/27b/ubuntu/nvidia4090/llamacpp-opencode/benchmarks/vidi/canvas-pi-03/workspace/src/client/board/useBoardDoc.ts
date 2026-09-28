import { useCallback, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from 'src/shared/board-model';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
}

/**
 * Owns the in-memory Y.Doc for the current board and exposes an immutable
 * snapshot of all sticky notes, recomputed on `objects.observeDeep`.
 *
 * Story 3 will attach a network provider to the same doc; story 4 will
 * persist it. Selection/editing state is deliberately NOT stored here —
 * see useSelection.
 */
export function useBoardDoc(): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  const cacheRef = useRef<{ notes: readonly StickySnapshot[] } | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
    cacheRef.current = { notes: snapshot(doc) };
  }
  const doc = docRef.current;

  const subscribe = useCallback(
    (onChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        if (cacheRef.current) {
          cacheRef.current.notes = snapshot(doc);
        }
        onChange();
      };
      objects.observeDeep(handler);
      return () => {
        objects.unobserveDeep(handler);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback(
    () => (cacheRef.current ? cacheRef.current.notes : EMPTY_NOTES),
    [],
  );

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { doc, notes };
}

const EMPTY_NOTES: readonly StickySnapshot[] = [];
