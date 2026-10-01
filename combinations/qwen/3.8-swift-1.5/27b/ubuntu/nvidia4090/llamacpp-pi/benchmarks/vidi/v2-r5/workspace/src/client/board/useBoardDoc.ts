// src/client/board/useBoardDoc.ts
import { useRef, useSyncExternalStore, useCallback, useEffect, useState } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot } from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

export function useBoardDoc(boardId?: string) {
  const docRef = useRef<Y.Doc | null>(null);
  const snapshotRef = useRef<readonly StickySnapshot[]>([]);
  const versionRef = useRef(0);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
    // Compute initial snapshot
    snapshotRef.current = snapshot(doc);
  }
  const doc = docRef.current;

  // Attach provider when boardId is provided
  useEffect(() => {
    if (!boardId) return;
    const conn = connectBoard(doc, boardId, (s) => setConnectionState(s));
    return () => {
      conn.destroy();
    };
  }, [doc, boardId]);

  const subscribe = useCallback((callback: () => void) => {
    const objects = doc.getMap('objects');
    const handler = () => {
      // Recompute snapshot and update the cached reference
      snapshotRef.current = snapshot(doc);
      versionRef.current++;
      callback();
    };
    objects.observeDeep(handler);
    return () => {
      objects.unobserveDeep(handler);
    };
  }, [doc]);

  const getSnapshot = useCallback(() => {
    return snapshotRef.current;
  }, []);

  const notes = useSyncExternalStore(subscribe, getSnapshot);

  return { doc, notes, connectionState };
}

export type { StickySnapshot, ConnectionState };
