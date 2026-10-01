import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot } from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';
import { reportConnectionState } from '../canvas/testHooks';
import { connectBoard } from '../sync/connectBoard';
import type { ConnectionState } from '../sync/connectBoard';

/** Without a `boardId` the doc stays local (no connection); with one it syncs live through the board's room. */
export function useBoardDoc(boardId?: string): {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  connection: ConnectionState;
} {
  const doc = useMemo(() => {
    const d = new Y.Doc();
    initDoc(d);
    return d;
  }, []);
  const cache = useRef<readonly StickySnapshot[] | null>(null);
  const [connection, setConnection] = useState<ConnectionState>(boardId ? 'connecting' : 'connected');

  useEffect(() => {
    if (!boardId) return;
    const conn = connectBoard(doc, boardId, (s) => {
      reportConnectionState(s);
      setConnection(s);
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
