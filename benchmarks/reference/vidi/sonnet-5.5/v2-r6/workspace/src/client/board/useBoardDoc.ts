import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type ObjectSnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';
import { setTestConnectionState } from '../canvas/testHooks';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly ObjectSnapshot[];
  /** Absent when the doc is not connected to a room (component tests). */
  connection?: ConnectionState;
  /** The board this document syncs with (uploads go to it); absent for local documents. */
  boardId?: string;
}

interface Store {
  doc: Y.Doc;
  subscribe(cb: () => void): () => void;
  getSnapshot(): readonly ObjectSnapshot[];
}

function createStore(): Store {
  const doc = new Y.Doc();
  initDoc(doc);
  let current = snapshot(doc);
  const objects = doc.getMap('objects');
  return {
    doc,
    subscribe(cb) {
      const handler = () => {
        current = snapshot(doc);
        cb();
      };
      objects.observeDeep(handler);
      return () => objects.unobserveDeep(handler);
    },
    getSnapshot: () => current,
  };
}

/** A local-only board document (no network); component tests use this directly. */
export function useLocalBoardDoc(key: string = ''): BoardDoc & { store: Store } {
  // A new key means a new document, so nothing leaks between boards.
  const store = useMemo(createStore, [key]);
  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { doc: store.doc, notes, store };
}

/** Owns the board's Y.Doc, syncs it with the board's room, and exposes an immutable snapshot. */
export function useBoardDoc(boardId: string): BoardDoc {
  const { doc, notes, store } = useLocalBoardDoc(boardId);
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  useEffect(() => {
    setConnection('connecting');
    const conn = connectBoard(store.doc, boardId, (s) => {
      setConnection(s);
      setTestConnectionState(s);
    });
    return () => conn.destroy();
  }, [store, boardId]);

  return { doc, notes, connection, boardId };
}
