import { useCallback, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, getObjectsMap } from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';

export interface BoardDoc {
  doc: Y.Doc;
  /** Immutable notes sorted by (z, id). Recomputed on any document change. */
  notes: readonly StickySnapshot[];
}

/**
 * Owns the single `Y.Doc` of this board and exposes an immutable snapshot to
 * React via `useSyncExternalStore`. Story 3 attaches a network provider to the
 * returned doc; story 4 persists it. Selection and editing are local state and
 * never written here.
 */
export function useBoardDoc(): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const revisionRef = useRef(0);
  const cacheRef = useRef<{ rev: number; value: readonly StickySnapshot[] } | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = getObjectsMap(doc);
      const observer = () => {
        revisionRef.current += 1;
        onStoreChange();
      };
      objects.observeDeep(observer);
      return () => {
        objects.unobserveDeep(observer);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    if (!cacheRef.current || cacheRef.current.rev !== revisionRef.current) {
      cacheRef.current = { rev: revisionRef.current, value: snapshot(doc) };
    }
    return cacheRef.current.value;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { doc, notes };
}
