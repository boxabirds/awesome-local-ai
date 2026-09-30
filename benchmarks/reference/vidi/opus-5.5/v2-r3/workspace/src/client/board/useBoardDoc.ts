import { useEffect, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { getObjectsMap, initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

/**
 * Wraps a Y.Doc as an external store whose snapshot is recomputed (once) on
 * every change to `objects`, whether local or from the network provider.
 */
class BoardStore {
  readonly doc: Y.Doc;
  private current: readonly StickySnapshot[];
  private readonly listeners = new Set<() => void>();

  constructor(doc: Y.Doc) {
    this.doc = doc;
    initDoc(doc);
    this.current = snapshot(doc);
    getObjectsMap(doc).observeDeep(this.onChange);
  }

  private onChange = () => {
    this.current = snapshot(this.doc);
    for (const l of this.listeners) l();
  };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.current;
}

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  connection: ConnectionState;
}

/**
 * Owns the board's Y.Doc (one per board id) and keeps it connected to the
 * board's room while mounted. Remote updates re-render through the same
 * observer as local ones.
 */
export function useBoardDoc(boardId: string): BoardDoc {
  // The store observes its own doc for the doc's whole lifetime (both are
  // garbage-collected together), which keeps StrictMode effect replays safe.
  const [current, setCurrent] = useState(() => ({ boardId, store: new BoardStore(new Y.Doc()) }));
  let { store } = current;
  if (current.boardId !== boardId) {
    store = new BoardStore(new Y.Doc());
    setCurrent({ boardId, store });
  }
  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  const [connection, setConnection] = useState<ConnectionState>('connecting');
  useEffect(() => {
    const conn = connectBoard(store.doc, boardId, setConnection);
    return () => conn.destroy();
  }, [store, boardId]);

  return { doc: store.doc, notes, connection };
}
