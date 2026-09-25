import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '@/shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';
import { registerConnectionTestHook } from '../canvas/testHooks';

export interface BoardDoc {
  /** The in-memory Yjs document (a fresh doc per board id). */
  doc: Y.Doc;
  /** Immutable snapshot of all sticky notes, sorted by (z, id). */
  notes: readonly StickySnapshot[];
  /** Live connection state for the board's sync provider. */
  connectionState: ConnectionState;
}

/**
 * Owns the board's Y.Doc for this page and exposes an immutable snapshot via
 * useSyncExternalStore. The doc is created per `boardId` and a y-websocket
 * provider is attached for the lifetime of the board (story 3), so local and
 * remote edits both flow through `doc` and re-render via `observeDeep`.
 */
export function useBoardDoc(boardId: string): BoardDoc {
  const doc = useMemo(() => {
    const d = new Y.Doc();
    initDoc(d);
    return d;
  }, [boardId]);

  // (Re)connect the sync provider whenever the doc/board changes.
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  useEffect(() => {
    setConnectionState('connecting');
    const conn = connectBoard(doc, boardId, setConnectionState);
    // Test-only: expose handles to drop/resume the connection (story 3 outage test).
    if (import.meta.env.MODE === 'test') {
      registerConnectionTestHook({ drop: () => conn.drop(), resume: () => conn.resume() });
    }
    return () => conn.destroy();
  }, [doc, boardId]);

  const cacheRef = useRef<readonly StickySnapshot[] | null>(null);
  useEffect(() => {
    cacheRef.current = null;
  }, [doc]);

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    if (cacheRef.current === null) {
      cacheRef.current = snapshot(doc);
    }
    return cacheRef.current;
  }, [doc]);

  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        cacheRef.current = snapshot(doc);
        onStoreChange();
      };
      objects.observeDeep(handler);
      return () => {
        objects.unobserveDeep(handler);
      };
    },
    [doc],
  );

  const notes = useSyncExternalStore(subscribe, getSnapshot);
  return { doc, notes, connectionState };
}
