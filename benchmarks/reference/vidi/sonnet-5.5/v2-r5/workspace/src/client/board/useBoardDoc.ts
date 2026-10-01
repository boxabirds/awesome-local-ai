import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

export interface BoardDoc { doc: Y.Doc; notes: readonly StickySnapshot[]; connection: ConnectionState }

export function useBoardDoc(boardId: string): BoardDoc {
  const store = useMemo(() => {
    const doc = new Y.Doc();
    initDoc(doc);
    let current = snapshot(doc);
    const objects = doc.getMap('objects');
    return {
      doc,
      subscribe(cb: () => void) {
        const handler = () => { current = snapshot(doc); cb(); };
        objects.observeDeep(handler);
        return () => objects.unobserveDeep(handler);
      },
      get: () => current,
    };
  }, [boardId]);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  useEffect(() => {
    setConnection('connecting');
    const conn = connectBoard(store.doc, boardId, setConnection);
    return () => conn.destroy();
  }, [store, boardId]);
  const notes = useSyncExternalStore(store.subscribe, store.get);
  return { doc: store.doc, notes, connection };
}
