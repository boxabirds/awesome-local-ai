import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, createSticky, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';
import { installDocHooks } from '../canvas/testHooks';

export interface BoardDocState {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  connectionState: ConnectionState;
}

/**
 * Owns a single Y.Doc, subscribes to deep changes on `objects`,
 * and exposes an immutable snapshot via useSyncExternalStore.
 * Also manages the WebSocket connection for live collaboration.
 */
export function useBoardDoc(boardId: string): BoardDocState {
  const doc = useMemo(() => {
    const d = new Y.Doc();
    initDoc(d);
    installDocHooks(Y, (doc, pos) => createSticky(doc, pos));
    return d;
  }, []);

  const objectsMap = useMemo(
    () => doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>,
    [doc],
  );

  const snapRef = useRef<readonly StickySnapshot[]>(snapshot(doc));

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const observer = () => {
        snapRef.current = snapshot(doc);
        onStoreChange();
      };
      objectsMap.observeDeep(observer);
      return () => {
        objectsMap.unobserveDeep(observer);
      };
    },
    [doc, objectsMap],
  );

  const getSnapshot = useCallback(() => snapRef.current, []);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Connection state
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    const conn = connectBoard(doc, boardId, setConnectionState);
    return () => conn.destroy();
  }, [doc, boardId]);

  return { doc, notes, connectionState };
}
