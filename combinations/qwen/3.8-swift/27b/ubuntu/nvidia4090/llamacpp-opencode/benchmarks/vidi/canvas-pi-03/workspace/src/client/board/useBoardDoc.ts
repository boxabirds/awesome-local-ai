import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { snapshot, allObjects, type ObjectSnapshot, type StickySnapshot } from 'src/shared/board-model';
import { connectBoard, type ConnectionState } from 'src/client/sync/connectBoard';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  /** Story 7: every object of every registered type (generic machinery). */
  objects: readonly ObjectSnapshot[];
  connectionState: ConnectionState;
  /** Test seam: drop the sync socket (flaky Wi-Fi). Pair with `resumeSocket`. */
  dropSocket: () => void;
  /** Test seam: resume the dropped sync socket (reconnects + re-syncs). */
  resumeSocket: () => void;
}

interface BoardCache {
  notes: readonly StickySnapshot[];
  objects: readonly ObjectSnapshot[];
}

const EMPTY: BoardCache = { notes: [], objects: [] };

/**
 * Owns the in-memory Y.Doc for the current board and exposes an immutable
 * snapshot of all sticky notes, recomputed on `objects.observeDeep`.
 *
 * Story 3 attaches a network provider to the same doc: local edits and remote
 * updates both flow through the doc and re-render identically. The provider is
 * created for `boardId` and destroyed on unmount / board change.
 *
 * Selection/editing state is deliberately NOT stored here — see useSelection.
 */
export function useBoardDoc(boardId: string): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  const cacheRef = useRef<BoardCache | null>(null);
  const connRef = useRef<ReturnType<typeof connectBoard> | null>(null);
  if (docRef.current === null) {
    // The server is the authority: it creates the initial state (meta.schemaVersion).
    // The client must NOT call initDoc - doing so would create a divergent meta op
    // (different Yjs client ID) and cause endless re-sync churn.
    const doc = new Y.Doc();
    docRef.current = doc;
    cacheRef.current = { notes: snapshot(doc), objects: allObjects(doc) };
  }
  const doc = docRef.current;

  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  // Attach the network provider for this board; destroy it on unmount or when
  // the board changes. `setConnectionState` is stable, so deps are [doc, boardId].
  useEffect(() => {
    setConnectionState('connecting');
    const conn = connectBoard(doc, boardId, setConnectionState);
    connRef.current = conn;
    return () => {
      connRef.current = null;
      conn.destroy();
    };
  }, [doc, boardId]);

  const subscribe = useCallback(
    (onChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        cacheRef.current = { notes: snapshot(doc), objects: allObjects(doc) };
        onChange();
      };
      objects.observeDeep(handler);
      return () => {
        objects.unobserveDeep(handler);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback(
    () => cacheRef.current ?? EMPTY,
    [],
  );

  const board = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const dropSocket = useCallback(() => {
    connRef.current?.dropSocket();
  }, []);
  const resumeSocket = useCallback(() => {
    connRef.current?.resumeSocket();
  }, []);

  return { doc, notes: board.notes, objects: board.objects, connectionState, dropSocket, resumeSocket };
}
