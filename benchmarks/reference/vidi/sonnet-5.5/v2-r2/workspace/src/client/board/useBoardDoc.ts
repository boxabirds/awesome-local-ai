import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  connectionState: ConnectionState;
}

/**
 * Owns the Y.Doc (or adopts `external`) and exposes an immutable snapshot.
 * With a `boardId` it also syncs the doc with the board's room.
 */
export function useBoardDoc(external?: Y.Doc, boardId?: string): BoardDoc {
  const doc = useMemo(() => {
    const d = external ?? new Y.Doc();
    initDoc(d);
    return d;
  }, [external, boardId]);

  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    if (!boardId) return;
    const conn = connectBoard(doc, boardId, setConnectionState);
    return () => conn.destroy();
  }, [doc, boardId]);

  const versionRef = useRef(0);
  const cache = useRef<{ doc: Y.Doc; version: number; value: readonly StickySnapshot[] } | null>(null);

  const subscribe = useMemo(() => (onChange: () => void) => {
    const objects = doc.getMap('objects');
    const handler = () => { versionRef.current += 1; onChange(); };
    objects.observeDeep(handler);
    return () => objects.unobserveDeep(handler);
  }, [doc]);

  // Memoised per document version so useSyncExternalStore sees a stable reference.
  const getSnapshot = () => {
    const c = cache.current;
    if (c && c.doc === doc && c.version === versionRef.current) return c.value;
    const value = snapshot(doc);
    cache.current = { doc, version: versionRef.current, value };
    return value;
  };

  const notes = useSyncExternalStore(subscribe, getSnapshot);
  return { doc, notes, connectionState };
}
