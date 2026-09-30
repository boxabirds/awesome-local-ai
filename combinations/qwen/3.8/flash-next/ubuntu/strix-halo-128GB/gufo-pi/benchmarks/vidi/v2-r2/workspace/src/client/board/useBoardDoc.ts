import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '@shared/board-model';
import { connectBoard, type ConnectionState, type BoardConnection } from '@client/sync/connectBoard';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  connectionState: ConnectionState;
}

export function useBoardDoc(boardId: string): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (!docRef.current) {
    docRef.current = new Y.Doc();
    initDoc(docRef.current);
  }
  const doc = docRef.current;

  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  const cacheRef = useRef<readonly StickySnapshot[]>([]);

  const subscribe = useMemo(() => {
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    return (onStoreChange: () => void) => {
      const observer = () => {
        cacheRef.current = snapshot(doc);
        onStoreChange();
      };
      objects.observeDeep(observer);
      cacheRef.current = snapshot(doc);
      return () => {
        objects.unobserveDeep(observer);
      };
    };
  }, [doc]);

  const getSnapshot = useMemo(() => {
    cacheRef.current = snapshot(doc);
    return () => cacheRef.current;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot);

  // Attach/detach WebSocket provider when boardId changes
  useEffect(() => {
    const connection: BoardConnection = connectBoard(doc, boardId, setConnectionState);
    return () => {
      connection.destroy();
    };
  }, [doc, boardId]);

  // Expose connection state for e2e tests
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      if (!window.__vidi6) window.__vidi6 = { setCamera: () => {} };
      window.__vidi6.connectionState = connectionState;
    }
  }, [connectionState]);

  return { doc, notes, connectionState };
}
