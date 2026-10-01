import { useRef, useSyncExternalStore, useCallback, useEffect, useState } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

export function useBoardDoc(boardId: string): {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  connectionState: ConnectionState;
} {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    docRef.current = new Y.Doc();
    initDoc(docRef.current);
  }
  const doc = docRef.current;

  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  // Attach/detach the sync provider when boardId changes
  useEffect(() => {
    if (!boardId) return;
    const connection = connectBoard(doc, boardId, (s) => {
      setConnectionState(s);
    });
    return () => {
      connection.destroy();
    };
  }, [doc, boardId]);

  const subscribe = useCallback(
    (callback: () => void) => {
      const objects = doc.getMap('objects');
      objects.observeDeep(callback);
      return () => objects.unobserveDeep(callback);
    },
    [doc],
  );

  const getSnapshot = useCallback(() => {
    return snapshot(doc);
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot);

  return { doc, notes, connectionState };
}
