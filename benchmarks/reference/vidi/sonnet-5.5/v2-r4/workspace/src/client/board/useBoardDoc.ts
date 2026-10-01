import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type ObjectSnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

/**
 * Owns the board Y.Doc (or adopts the one passed in) and exposes an immutable, memoised snapshot.
 * With a boardId the doc is synced through the board room; without one it stays local.
 */
export function useBoardDoc(
  external?: Y.Doc,
  boardId?: string,
): { doc: Y.Doc; notes: readonly ObjectSnapshot[]; connection: ConnectionState } {
  const doc = useMemo(() => {
    const d = external ?? new Y.Doc();
    initDoc(d);
    return d;
  }, [external]);

  const [connection, setConnection] = useState<ConnectionState>('connecting');
  useEffect(() => {
    if (!boardId) return;
    setConnection('connecting');
    const conn = connectBoard(doc, boardId, setConnection);
    return () => conn.destroy();
  }, [doc, boardId]);

  const cache = useRef<{ doc: Y.Doc; value: readonly ObjectSnapshot[] | null }>({ doc, value: null });
  if (cache.current.doc !== doc) cache.current = { doc, value: null };

  const subscribe = useCallback(
    (onChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        cache.current = { doc, value: null };
        onChange();
      };
      objects.observeDeep(handler);
      return () => objects.unobserveDeep(handler);
    },
    [doc],
  );
  const getSnapshot = useCallback(() => {
    if (cache.current.value === null) cache.current.value = snapshot(doc);
    return cache.current.value;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { doc, notes, connection };
}
