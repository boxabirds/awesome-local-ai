import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshotObjects, type ObjectSnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

export interface BoardDoc { doc: Y.Doc; objects: readonly ObjectSnapshot[]; connection: ConnectionState }

export function useBoardDoc(boardId: string): BoardDoc {
  const store = useMemo(() => {
    const doc = new Y.Doc();
    initDoc(doc);
    let current = snapshotObjects(doc);
    const map = doc.getMap('objects');
    return {
      doc,
      subscribe(cb: () => void) {
        const handler = () => { current = snapshotObjects(doc); cb(); };
        map.observeDeep(handler);
        return () => map.unobserveDeep(handler);
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
  const objects = useSyncExternalStore(store.subscribe, store.get);
  return { doc: store.doc, objects, connection };
}
