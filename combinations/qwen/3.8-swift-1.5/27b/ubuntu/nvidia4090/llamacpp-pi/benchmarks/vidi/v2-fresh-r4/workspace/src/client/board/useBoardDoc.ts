import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

/**
 * Owns the Y.Doc, exposes an immutable snapshot via useSyncExternalStore,
 * and (when boardId is provided) attaches a network provider for live sync.
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

  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  // Attach/detach the network provider when boardId changes
  useEffect(() => {
    if (!boardId) return;
    const conn = connectBoard(doc, boardId, setConnectionState);
    return () => {
      conn.destroy();
    };
  }, [doc, boardId]);

  // Cache the snapshot so getSnapshot returns a stable reference
  // until the doc actually changes.
  const snapshotCacheRef = useRef<{ version: number; value: readonly StickySnapshot[] }>({
    version: -1,
    value: [],
  });
  const versionRef = useRef(0);

  const subscribe = useMemo(() => {
    return (callback: () => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        versionRef.current++;
        callback();
      };
      objects.observeDeep(handler);
      return () => {
        objects.unobserveDeep(handler);
      };
    };
  }, [doc]);

  const getSnapshot = useMemo(() => {
    return () => {
      const cache = snapshotCacheRef.current;
      if (cache.version === versionRef.current) {
        return cache.value;
      }
      const value = snapshot(doc);
      snapshotCacheRef.current = { version: versionRef.current, value };
      return value;
    };
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { doc, notes, connectionState };
}
