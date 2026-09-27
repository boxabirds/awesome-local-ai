// Owns the in-memory Y.Doc and exposes an immutable note snapshot to React
// via useSyncExternalStore (see spec: board.model — "snapshot is memoised by
// useBoardDoc and recomputed on objects.observeDeep"). Story 3 attaches the
// network provider to the same document (connectBoard); story 4 persists it.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import {
  connectBoard,
  type BoardConnection,
  type ConnectionState,
} from '../sync/connectBoard';
import { initDoc, snapshot, type ObjectSnapshot } from '../../shared/board-model';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly ObjectSnapshot[];
  /** Live connection state for the ConnectionStatus badge. */
  connectionState: ConnectionState;
  /** Test-only: force the connection state (e.g. load_failed). */
  setConnectionState(state: ConnectionState): void;
}

export function useBoardDoc(boardId: string): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;
  const cacheRef = useRef<{ notes: readonly ObjectSnapshot[] } | null>(null);

  const getSnapshot = useCallback(() => {
    if (cacheRef.current === null) cacheRef.current = { notes: snapshot(doc) };
    return cacheRef.current.notes;
  }, [doc]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        cacheRef.current = { notes: snapshot(doc) };
        onStoreChange();
      };
      objects.observeDeep(handler);
      return () => objects.unobserveDeep(handler);
    },
    [doc],
  );

  // Attach the provider for this board; destroy it on unmount or board change.
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  useEffect(() => {
    const connection: BoardConnection = connectBoard(doc, boardId, setConnectionState);
    return () => connection.destroy();
  }, [doc, boardId]);

  return {
    doc,
    notes: useSyncExternalStore(subscribe, getSnapshot),
    connectionState,
    setConnectionState: useCallback((state: ConnectionState) => setConnectionState(state), []),
  };
}
