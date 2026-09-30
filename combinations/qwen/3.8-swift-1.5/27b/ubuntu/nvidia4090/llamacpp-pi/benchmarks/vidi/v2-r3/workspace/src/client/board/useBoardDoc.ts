import { useRef, useCallback, useSyncExternalStore, useEffect, useState } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

/**
 * Owns the in-memory `Y.Doc` for the board and exposes an immutable snapshot
 * of the objects via `useSyncExternalStore`. When a `boardId` is provided,
 * attaches a y-websocket provider for live collaboration.
 */
export function useBoardDoc(boardId?: string): {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  connectionState: ConnectionState;
} {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  // The snapshot is recomputed only on document changes and cached, so
  // getSnapshot returns a stable reference until something mutates the doc.
  const cacheRef = useRef<readonly StickySnapshot[] | null>(null);
  if (cacheRef.current === null) {
    cacheRef.current = snapshot(doc);
  }

  const subscribe = useCallback(
    (onChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        cacheRef.current = snapshot(doc);
        onChange();
      };
      objects.observeDeep(handler);
      return () => {
        objects.unobserveDeep(handler);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback(() => cacheRef.current as readonly StickySnapshot[], [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot);

  // Connection state
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    if (!boardId) return;
    const conn = connectBoard(doc, boardId, setConnectionState);
    // Expose debug hooks for e2e tests
    (window as any).__VIDI_DEBUG__ = { doc };
    (window as any).__VIDI_Y__ = Y;
    return () => {
      conn.destroy();
      delete (window as any).__VIDI_DEBUG__;
      delete (window as any).__VIDI_Y__;
    };
  }, [doc, boardId]);

  return { doc, notes, connectionState };
}
