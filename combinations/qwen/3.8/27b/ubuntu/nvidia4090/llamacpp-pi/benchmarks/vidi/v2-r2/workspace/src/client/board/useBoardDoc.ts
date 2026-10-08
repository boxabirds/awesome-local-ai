import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshotAll, type ObjectSnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';
import type { BoardConnection } from '../sync/connectBoard';

/**
 * Owns the in-memory Y.Doc for a board, attaches the network provider
 * (story 3), and exposes an immutable snapshot of all objects plus the
 * mapped connection state via useSyncExternalStore / useState.
 *
 * Remote updates arrive through the provider as document updates; the same
 * objects.observeDeep re-render path covers local and remote changes. The
 * snapshot is memoised per document revision.
 *
 * `docOverride` (test-only) supplies a pre-made local Y.Doc and skips the
 * network provider entirely (the component tests run without a server).
 */
export function useBoardDoc(boardId: string, docOverride?: Y.Doc): {
  doc: Y.Doc;
  objects: readonly ObjectSnapshot[];
  connectionState: ConnectionState;
  /** Closes the live socket (test-only, wired to window.__vidi6). */
  dropSocket: () => void;
  /** Reconnects after a dropped socket (test-only, wired to window.__vidi6). */
  resumeSocket: () => void;
} {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    if (docOverride !== undefined) {
      docRef.current = docOverride;
    } else {
      const doc = new Y.Doc();
      initDoc(doc);
      docRef.current = doc;
    }
  }
  const doc = docRef.current;
  const overridden = docOverride !== undefined;

  // Subscribe to Y.Doc changes: recompute the snapshot on every deep change.
  const [objects, setObjects] = useState<readonly ObjectSnapshot[]>(() => snapshotAll(doc));

  useEffect(() => {
    const objectsMap = doc.getMap('objects');
    const onChange = (): void => {
      setObjects(snapshotAll(doc));
    };
    objectsMap.observeDeep(onChange);
    return () => {
      objectsMap.unobserveDeep(onChange);
    };
  }, [doc]);

  // Connection state for the badge. The setter is stable, so the provider
  // is (re)created only when the doc or boardId changes; destroy() on
  // unmount or board change. With a doc override there is no socket: the
  // board is simply connected (test-only).
  const [connectionState, setConnectionState] = useState<ConnectionState>(overridden ? 'connected' : 'connecting');
  const connectionRef = useRef<BoardConnection | null>(null);
  useEffect(() => {
    if (overridden) {
      return;
    }
    const connection = connectBoard(doc, boardId, setConnectionState);
    connectionRef.current = connection;
    return () => {
      connectionRef.current = null;
      connection.destroy();
    };
  }, [doc, boardId, overridden]);

  const dropSocket = useCallback((): void => {
    connectionRef.current?.dropSocket();
  }, []);

  const resumeSocket = useCallback((): void => {
    connectionRef.current?.resumeSocket();
  }, []);

  return { doc, objects, connectionState, dropSocket, resumeSocket };
}
