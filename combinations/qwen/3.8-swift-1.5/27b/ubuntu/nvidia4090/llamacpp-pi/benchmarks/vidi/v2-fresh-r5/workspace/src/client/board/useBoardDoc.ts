import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

/**
 * Owns the Y.Doc for a board, exposes an immutable snapshot via
 * useSyncExternalStore, and keeps the y-websocket provider attached for the
 * lifetime of the board (destroyed on unmount or board change). Remote
 * updates re-render through the same `observeDeep` path as local changes.
 */
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

  // We need a mutable ref to hold the current snapshot, updated by the observer.
  // useSyncExternalStore requires getSnapshot to return a cached value.
  const stateRef = useRef<{ notes: readonly StickySnapshot[] }>({
    notes: snapshot(doc),
  });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        stateRef.current.notes = snapshot(doc);
        onStoreChange();
      };
      objects.observeDeep(handler);
      return () => objects.unobserveDeep(handler);
    },
    [doc],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    return stateRef.current.notes;
  }, []);

  const notes = useSyncExternalStore(subscribe, getSnapshot);

  // Live connection: attach the provider for this board; destroy on unmount
  // or board change.
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  useEffect(() => {
    setConnectionState('connecting');
    const { destroy } = connectBoard(doc, boardId, setConnectionState);
    return destroy;
  }, [doc, boardId]);

  return { doc, notes, connectionState };
}
