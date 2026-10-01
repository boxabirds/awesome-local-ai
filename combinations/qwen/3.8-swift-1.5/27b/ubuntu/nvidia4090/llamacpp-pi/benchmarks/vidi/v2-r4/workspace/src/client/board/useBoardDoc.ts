import { useRef, useSyncExternalStore, useCallback, useEffect, useState } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

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

  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  // Attach/detach the sync provider when boardId changes
  useEffect(() => {
    if (!boardId) return;
    const connection = connectBoard(doc, boardId, (s) => {
      setConnectionState(s);
    });
    return () => {
      connection.destroy();
    };
  }, [doc, boardId]);

  const snapshotCacheRef = useRef<{ key: string; value: readonly StickySnapshot[] }>({ key: '', value: [] });

  const subscribe = useCallback(
    (callback: () => void) => {
      const objects = doc.getMap('objects');
      objects.observeDeep(callback);
      return () => objects.unobserveDeep(callback);
    },
    [doc],
  );

  const getSnapshot = useCallback(() => {
    const snap = snapshot(doc);
    // Create a stable key from the snapshot content
    const key = snap.map((o) => `${o.id}:${o.x}:${o.y}:${o.z}:${o.width ?? ''}:${o.height ?? ''}`).join('\0');
    if (key !== snapshotCacheRef.current.key) {
      snapshotCacheRef.current = { key, value: snap };
    }
    return snapshotCacheRef.current.value;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot);

  return { doc, notes, connectionState };
}
