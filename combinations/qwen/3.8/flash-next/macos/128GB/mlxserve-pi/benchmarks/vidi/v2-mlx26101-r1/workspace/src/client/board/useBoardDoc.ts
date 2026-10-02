import { useCallback, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import {
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../shared/board-model';

export interface BoardDoc {
  /** The live Y.Doc. Story 3 attaches a network provider to it; story 4 persists it. */
  doc: Y.Doc;
  /**
   * Immutable render model derived from the document, sorted by (z, id). A new
   * array reference is produced only when the document actually changes, so it
   * is a valid `useSyncExternalStore` snapshot.
   */
  notes: readonly StickySnapshot[];
}

/**
 * Owns a single in-memory `Y.Doc` for the board and exposes an immutable
 * snapshot to React. The snapshot is memoised and recomputed only when the
 * objects map (or any nested object, including a note's Y.Text) changes, so
 * `useSyncExternalStore` never sees a spurious new reference.
 */
export function useBoardDoc(): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  // Cache the snapshot so getSnapshot returns a stable reference between
  // document changes; only the observer recomputes it.
  const cacheRef = useRef<readonly StickySnapshot[] | null>(null);
  if (cacheRef.current === null) cacheRef.current = snapshot(doc);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const observer = () => {
        cacheRef.current = snapshot(doc);
        onStoreChange();
      };
      objects.observeDeep(observer);
      return () => objects.unobserveDeep(observer);
    },
    [doc],
  );

  const getSnapshot = useCallback(
    () => cacheRef.current as readonly StickySnapshot[],
    [],
  );

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { doc, notes };
}
