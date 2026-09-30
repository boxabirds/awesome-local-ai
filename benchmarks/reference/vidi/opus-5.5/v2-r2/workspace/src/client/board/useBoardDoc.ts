import { useEffect, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { type ObjectSnapshot, initDoc, objectsMap, objectsSnapshot } from '../../shared/board-model';
import { type ConnectionState, connectBoard } from '../sync/connectBoard';

interface BoardStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly ObjectSnapshot[];
}

/** Memoised snapshot of `doc`, recomputed only after the objects change. */
function createBoardStore(doc: Y.Doc): BoardStore {
  let cached: readonly ObjectSnapshot[] | null = null;
  const listeners = new Set<() => void>();
  objectsMap(doc).observeDeep(() => {
    cached = null;
    for (const listener of listeners) listener();
  });
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      cached ??= objectsSnapshot(doc);
      return cached;
    },
  };
}

/**
 * Owns the board's Y.Doc and exposes an immutable, memoised snapshot of its objects.
 * With a `boardId` the doc is connected to that board's live room (destroyed on
 * unmount or board change); remote updates re-render through the same observer
 * as local ones. Without one the doc stays local (component tests).
 */
export function useBoardDoc(
  boardId?: string | null,
  existing?: Y.Doc,
): { doc: Y.Doc; objects: readonly ObjectSnapshot[]; connection: ConnectionState } {
  const [store] = useState(() => {
    const doc = existing ?? new Y.Doc();
    initDoc(doc);
    return { doc, ...createBoardStore(doc) };
  });
  const objects = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  useEffect(() => {
    if (!boardId) return;
    const connection = connectBoard(store.doc, boardId, setConnection);
    return () => connection.destroy();
  }, [store, boardId]);
  return { doc: store.doc, objects, connection };
}
