// Owns the Y.Doc (the board's source of truth from day one), attaches the
// live-collaboration provider for `boardId` (story 3), and exposes an
// immutable snapshot of the objects to React via useSyncExternalStore.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, objectsSnapshot, type ObjectSnapshot } from '../../shared/board-model';
import { connectBoard, type BoardConnection, type ConnectionState } from '../sync/connectBoard';

export interface Board {
  /** The live Y.Doc (never shared across components). */
  doc: Y.Doc;
  /** Immutable object snapshots (every board-schema type), sorted by
   *  (z, id). Stable reference between document changes. */
  objects: readonly ObjectSnapshot[];
  /** Live connection badge state (story 3). */
  connectionState: ConnectionState;
  /** The live provider connection, for test hooks (null before first mount). */
  connectionRef: { current: BoardConnection | null };
}

export function useBoardDoc(boardId: string): Board {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  // The snapshot is recomputed exactly once per document change (inside the
  // observeDeep callback) and stays the same reference until the next change,
  // as useSyncExternalStore requires. Remote updates re-render through the
  // same observeDeep subscription.
  const cacheRef = useRef<readonly ObjectSnapshot[]>(objectsSnapshot(doc));

  const subscribe = useCallback(
    (onChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = (): void => {
        cacheRef.current = objectsSnapshot(doc);
        onChange();
      };
      objects.observeDeep(handler);
      return () => objects.unobserveDeep(handler);
    },
    [doc],
  );

  const getSnapshot = useCallback(() => cacheRef.current, [doc]);
  const objects = useSyncExternalStore(subscribe, getSnapshot);

  // Story 3: attach the y-websocket provider for this board and track the
  // badge state. Destroyed on unmount or when the board changes.
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const connectionRef = useRef<BoardConnection | null>(null);
  useEffect(() => {
    setConnectionState('connecting');
    const connection = connectBoard(doc, boardId, setConnectionState);
    connectionRef.current = connection;
    return () => {
      connectionRef.current = null;
      connection.destroy();
    };
  }, [doc, boardId]);

  return { doc, objects, connectionState, connectionRef };
}
