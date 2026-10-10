// Owns the single in-memory Y.Doc for this page, exposes an immutable
// snapshot of the board objects via useSyncExternalStore, and keeps the
// provider connection state (story 3). Story 4 persists this same doc.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import {
  initDoc,
  objectSnapshots,
  snapshot,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  objects: readonly ObjectSnapshot[];
  connection: ConnectionState;
}

export function useBoardDoc(boardId: string): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const [connection, setConnection] = useState<ConnectionState>('connecting');
  useEffect(() => {
    setConnection('connecting');
    const handle = connectBoard(doc, boardId, setConnection);
    return () => handle.destroy();
  }, [doc, boardId]);

  const snapRef = useRef<{ notes: readonly StickySnapshot[]; objects: readonly ObjectSnapshot[] }>({
    notes: snapshot(doc),
    objects: objectSnapshots(doc),
  });
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const observer = () => {
        const objects = objectSnapshots(doc);
        snapRef.current = {
          notes: objects.filter((o): o is StickySnapshot => o.type === 'sticky'),
          objects,
        };
        onStoreChange();
      };
      const objectsMap = doc.getMap<Y.Map<unknown>>('objects');
      objectsMap.observeDeep(observer);
      // Recompute in case a mutation landed between render and subscribe.
      observer();
      return () => objectsMap.unobserveDeep(observer);
    },
    [doc],
  );
  const getSnapshot = useCallback(() => snapRef.current, []);
  const board = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { doc, notes: board.notes, objects: board.objects, connection };
}
