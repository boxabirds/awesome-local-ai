// React hook that owns the Y.Doc and exposes an immutable snapshot
// via useSyncExternalStore. Story 3 attaches the network provider here:
// when a `boardId` is given the doc is connected to the board room and
// the UI connection state is reported.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type ObjectSnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

export function useBoardDoc(boardId?: string): {
  doc: Y.Doc;
  objects: readonly ObjectSnapshot[];
  connectionState: ConnectionState;
} {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    boardId ? 'connecting' : 'connected',
  );

  // Attach (and re-attach on board change) the network provider.
  useEffect(() => {
    if (!boardId) return;
    setConnectionState('connecting');
    const handle = connectBoard(doc, boardId, setConnectionState);
    return () => handle.destroy();
  }, [doc, boardId]);

  // Cache the snapshot so getSnapshot returns a stable reference
  // when the doc hasn't changed (prevents infinite re-render loops).
  const snapshotCacheRef = useRef<{ dirty: boolean; value: readonly ObjectSnapshot[] }>({
    dirty: true,
    value: [],
  });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        snapshotCacheRef.current.dirty = true;
        onStoreChange();
      };
      objects.observeDeep(handler);
      return () => {
        objects.unobserveDeep(handler);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback(() => {
    if (snapshotCacheRef.current.dirty) {
      snapshotCacheRef.current.value = snapshot(doc);
      snapshotCacheRef.current.dirty = false;
    }
    return snapshotCacheRef.current.value;
  }, [doc]);

  const objects = useSyncExternalStore(subscribe, getSnapshot);

  return { doc, objects, connectionState };
}
