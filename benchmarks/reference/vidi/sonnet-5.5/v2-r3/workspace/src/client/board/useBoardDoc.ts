import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { publishConnectionState } from '../canvas/testHooks';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

/**
 * Owns the board's Y.Doc (or adopts `existing`, used by tests) and exposes an immutable snapshot.
 * With a `boardId` the doc is synced live through the board's room; without one it stays local.
 */
export function useBoardDoc(
  existing?: Y.Doc,
  boardId?: string,
): { doc: Y.Doc; notes: readonly StickySnapshot[]; connection: ConnectionState } {
  const doc = useMemo(() => {
    const d = existing ?? new Y.Doc();
    initDoc(d);
    return d;
  }, [existing]);
  const cache = useRef<readonly StickySnapshot[] | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  useEffect(() => {
    if (!boardId) return;
    setConnection('connecting');
    publishConnectionState('connecting');
    const conn = connectBoard(doc, boardId, (s) => {
      setConnection(s);
      publishConnectionState(s);
    });
    return () => conn.destroy();
  }, [doc, boardId]);

  const subscribe = useCallback(
    (onChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        cache.current = null;
        onChange();
      };
      objects.observeDeep(handler);
      return () => objects.unobserveDeep(handler);
    },
    [doc],
  );
  const getSnapshot = useCallback(() => (cache.current ??= snapshot(doc)), [doc]);
  const notes = useSyncExternalStore(subscribe, getSnapshot);
  return { doc, notes, connection };
}
