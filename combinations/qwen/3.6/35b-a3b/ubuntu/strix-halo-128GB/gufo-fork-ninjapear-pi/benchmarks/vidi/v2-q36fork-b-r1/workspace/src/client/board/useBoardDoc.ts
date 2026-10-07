import { useRef, useEffect, useState, useCallback } from 'react';
import * as Y from 'yjs';
import { snapshot, initDoc } from '@/shared/board-model';
import { connectBoard } from '../sync/connectBoard';
import type { ConnectionState } from '../sync/connectBoard';

let docRef: Y.Doc | null = null;

/**
 * Create or reuse a single Y.Doc instance.
 * Connects via WebSocket if a boardId is provided.
 * Exposes immutable snapshots via local React state updates.
 */
export function useBoardDoc(boardId?: string): {
  doc: Y.Doc;
  snap: readonly unknown[];
  connectionState: ConnectionState;
} {
  const [snap, setSnap] = useState(() => Object.freeze(snapshot(new Y.Doc())));
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    boardId ? 'connecting' : 'connected',
  );
  const connectRef = useRef<{ destroy(): void } | null>(null);

  // Lazy-create shared doc singleton
  if (!docRef) {
    docRef = new Y.Doc();
    initDoc(docRef);
    setSnap(Object.freeze(snapshot(docRef)));
  }

  // Subscribe to deep changes on the objects map
  useEffect(() => {
    const objectsMap = docRef!.getMap('objects');
    const handler = () => {
      setSnap(Object.freeze(snapshot(docRef!)));
    };
    objectsMap.observeDeep(handler);
    return () => {
      objectsMap.unobserveDeep(handler);
    };
  }, []);

  // Attach WebSocket provider when boardId is given
  useEffect(() => {
    if (!boardId) {
      setConnectionState('connected');
      return;
    }

    connectRef.current = connectBoard(docRef!, boardId, (state) => {
      setConnectionState(state);
    });

    return () => {
      connectRef.current?.destroy();
      connectRef.current = null;
    };
  }, [boardId]);

  return { doc: docRef!, snap, connectionState };
}
