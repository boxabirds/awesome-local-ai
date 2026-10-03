import { useEffect, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

interface BoardStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly StickySnapshot[];
  reobserve(): void;
  dispose(): void;
}

function createBoardStore(doc: Y.Doc): BoardStore {
  let listeners = new Set<() => void>();
  let value: readonly StickySnapshot[] = snapshot(doc);
  let observing = false;

  const onChange = () => {
    value = snapshot(doc);
    for (const listener of [...listeners]) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return value;
    },
    reobserve() {
      if (observing) return;
      observing = true;
      doc.getMap('objects').observeDeep(onChange);
    },
    dispose() {
      if (!observing) return;
      observing = false;
      doc.getMap('objects').unobserveDeep(onChange);
    },
  };
}

export interface UseBoardDocResult {
  /** The in-memory Y.Doc. Story 3 attaches a network provider; story 4 persists it. */
  doc: Y.Doc;
  /** Immutable snapshot of all sticky notes, sorted by (z, id). */
  notes: readonly StickySnapshot[];
}

/**
 * Owns the local Y.Doc and exposes an immutable snapshot of the board via
 * useSyncExternalStore. The snapshot is recomputed on `objects.observeDeep`.
 */
export function useBoardDoc(): UseBoardDocResult {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const storeRef = useRef<BoardStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createBoardStore(doc);
  }
  const store = storeRef.current;

  useEffect(() => {
    store.reobserve();
    return () => store.dispose();
  }, [store]);

  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { doc, notes };
}
