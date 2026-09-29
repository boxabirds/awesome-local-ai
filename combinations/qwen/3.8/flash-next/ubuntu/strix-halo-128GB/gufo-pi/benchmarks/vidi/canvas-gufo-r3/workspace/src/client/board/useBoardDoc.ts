import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, StickySnapshot } from '@shared/board-model';
import { connectBoard, type ConnectionState } from '@client/sync/connectBoard';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  connectionState: ConnectionState;
}

/**
 * Owns one Y.Doc and, when a `boardId` is supplied, a live network provider.
 * Exposes an immutable snapshot via useSyncExternalStore, recomputed on
 * objects.observeDeep — which fires for both local edits and remote updates the
 * provider applies, so other people's changes re-render this board too.
 *
 * Selection and editing state are deliberately NOT held here: they are local to
 * each client and never written to the doc (live.local_selection).
 */
export function useBoardDoc(boardId?: string): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (!docRef.current) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;
  const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    boardId ? 'connecting' : 'connected',
  );

  // Attach / detach the network provider when the board changes.
  useEffect(() => {
    if (!boardId) {
      setConnectionState('connected');
      return;
    }
    const conn = connectBoard(doc, boardId, setConnectionState);
    return () => conn.destroy();
  }, [doc, boardId]);

  const cacheRef = useRef<{ snap: readonly StickySnapshot[]; version: number }>({
    snap: [],
    version: -1,
  });

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    // Fall back to comparing content so React never sees a changing reference for
    // equal data (an unrelated remote update must not force a re-render loop).
    const next = snapshot(doc);
    const cache = cacheRef.current;
    if (cache.version === -1 || !snapshotsEqual(cache.snap, next)) {
      cacheRef.current = { snap: next, version: cache.version + 1 };
    }
    return cacheRef.current.snap;
  }, [doc]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const observer = () => onStoreChange();
      objects.observeDeep(observer);
      return () => objects.unobserveDeep(observer);
    },
    [objects],
  );

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo(
    () => ({ doc, notes, connectionState }),
    [doc, notes, connectionState],
  );
}

function snapshotsEqual(a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.x !== y.x ||
      x.y !== y.y ||
      x.color !== y.color ||
      x.text !== y.text ||
      x.z !== y.z ||
      x.createdAt !== y.createdAt
    ) {
      return false;
    }
  }
  return true;
}
