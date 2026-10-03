import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import {
  initDoc,
  snapshot,
  snapshotObjects,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

interface BoardStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly ObjectSnapshot[];
  reobserve(): void;
  dispose(): void;
}

function createBoardStore(doc: Y.Doc): BoardStore {
  let listeners = new Set<() => void>();
  let value: readonly ObjectSnapshot[] = snapshotObjects(doc);
  let observing = false;

  const onChange = () => {
    value = snapshotObjects(doc);
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
  /**
   * Immutable snapshot of every board object (any type), sorted by (z, id).
   * Reference-stable between doc changes (story 7 selection prunes on it).
   */
  objects: readonly ObjectSnapshot[];
  /** Immutable snapshot of all sticky notes, sorted by (z, id). */
  notes: readonly StickySnapshot[];
  /** Current connection state for the status badge. */
  connectionState: ConnectionState;
}

/**
 * Owns the local Y.Doc, attaches a network provider for the given boardId,
 * and exposes an immutable snapshot of the board via useSyncExternalStore.
 * The snapshot is recomputed on `objects.observeDeep`.
 */
export function useBoardDoc(boardId: string): UseBoardDocResult {
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

  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  // Observe doc changes
  useEffect(() => {
    store.reobserve();
    return () => store.dispose();
  }, [store]);

  // Attach network provider for the given board
  useEffect(() => {
    const conn = connectBoard(doc, boardId, setConnectionState);
    return () => conn.destroy();
  }, [doc, boardId]);

  const objects = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const notes = snapshot(doc);
  return { doc, objects, notes, connectionState };
}
