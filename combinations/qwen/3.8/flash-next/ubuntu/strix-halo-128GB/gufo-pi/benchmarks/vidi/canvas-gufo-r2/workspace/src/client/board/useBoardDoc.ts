/**
 * Owns the Y.Doc, exposes an immutable snapshot via useSyncExternalStore.
 * Story 3: attaches WebsocketProvider for live sync; destroys on unmount.
 *
 * The snapshot array is memoised: useSyncExternalStore requires getSnapshot to
 * return a stable reference when nothing has changed, otherwise React loops.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshotAll, type ObjectSnapshot } from '../../shared/board-model';
import { getObjectType } from '../objects/registry';
import { connectBoard, type ConnectionState, type BoardConnection } from '../sync/connectBoard';
import { setConnectionState as _setConnectionState } from '../canvas/testHooks';

export interface BoardDocState {
  doc: Y.Doc;
  notes: readonly ObjectSnapshot[];
  connectionState: ConnectionState;
}

/** Create a board doc (optionally inject one for tests). */
export function makeBoardDoc(injected?: Y.Doc): Y.Doc {
  const d = injected ?? new Y.Doc();
  initDoc(d);
  return d;
}

export function useBoardDoc(injectedDoc?: Y.Doc, boardId?: string): BoardDocState {
  // Create a single Y.Doc instance that persists across renders.
  const doc = useMemo(() => {
    return makeBoardDoc(injectedDoc);
  }, [injectedDoc]);

  // Connection state
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    boardId ? 'connecting' : 'connected'
  );

  // Attach provider when boardId is available
  useEffect(() => {
    if (!boardId) {
      setConnectionState('connected');
      return;
    }
    const conn: BoardConnection = connectBoard(doc, boardId, setConnectionState);
    return () => {
      conn.destroy();
    };
  }, [doc, boardId]);

  // Expose connection state on window for e2e tests (TC-29)
  useEffect(() => {
    _setConnectionState(connectionState);
  }, [connectionState]);

  // Cached snapshot: recomputed only when the doc's objects map changes.
  const cacheRef = useRef<{ doc: Y.Doc; value: readonly ObjectSnapshot[] } | null>(null);

  const getSnapshot = useCallback((): readonly ObjectSnapshot[] => {
    const cached = cacheRef.current;
    if (cached && cached.doc === doc) return cached.value;
    // Unknown types are dropped here so they never render or become selectable.
    const value = snapshotAll(doc).filter((o) => getObjectType(o.type) !== undefined);
    cacheRef.current = { doc, value };
    return value;
  }, [doc]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');
      const observer = () => {
        // Invalidate cache so getSnapshot recomputes on next read.
        cacheRef.current = null;
        onStoreChange();
      };
      objects.observeDeep(observer);
      return () => objects.unobserveDeep(observer);
    },
    [doc],
  );

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { doc, notes, connectionState };
}
