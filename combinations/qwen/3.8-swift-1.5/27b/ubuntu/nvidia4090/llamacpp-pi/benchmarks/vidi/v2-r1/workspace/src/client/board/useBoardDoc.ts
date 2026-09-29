import { useRef, useSyncExternalStore, useCallback, useEffect, useState } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '@shared/board-model';
import { connectBoard, type ConnectionState } from '@client/sync/connectBoard';

export function useBoardDoc(boardId: string | null): { doc: Y.Doc; objects: readonly StickySnapshot[]; connectionState: ConnectionState } {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  // Cache the snapshot to maintain referential equality for useSyncExternalStore
  const snapshotRef = useRef<readonly StickySnapshot[]>(snapshot(doc));

  const subscribe = useCallback((callback: () => void) => {
    const objects = doc.getMap('objects');
    const observer = () => {
      snapshotRef.current = snapshot(doc);
      callback();
    };
    objects.observeDeep(observer);
    return () => {
      objects.unobserveDeep(observer);
    };
  }, [doc]);

  const getSnapshot = useCallback(() => {
    return snapshotRef.current;
  }, []);

  const objects = useSyncExternalStore(subscribe, getSnapshot);

  // Connection state
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    if (!boardId) return;
    const conn = connectBoard(doc, boardId, setConnectionState);
    return () => {
      conn.destroy();
    };
  }, [doc, boardId]);

  return { doc, objects, connectionState };
}
