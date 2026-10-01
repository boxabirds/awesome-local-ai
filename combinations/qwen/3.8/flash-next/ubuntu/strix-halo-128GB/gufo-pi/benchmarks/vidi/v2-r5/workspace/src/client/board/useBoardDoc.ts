import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState, type ConnectionHandle } from '../sync/connectBoard';

export interface UseBoardDocResult {
  /** The board's shared document (story 3 attaches a provider, story 4 persists it). */
  doc: Y.Doc;
  /** Render model: sticky notes sorted by `(z, id)`; identity is stable until a change. */
  notes: readonly StickySnapshot[];
  /** Connection state (undefined when no boardId is provided, e.g. in tests). */
  connectionState: ConnectionState | undefined;
}

/**
 * Owns the single `Y.Doc` of this page and exposes its sticky notes to React through
 * `useSyncExternalStore`. The snapshot is recomputed only when the `objects` map (or
 * anything inside it) changes, so unrelated renders reuse the same immutable array.
 *
 * `provided` renders an existing document (tests seed one; from story 3 on it is the
 * provider-backed document). It is read once, when the board mounts.
 *
 * `boardId` attaches a WebsocketProvider for live collaboration. When absent (e.g. tests),
 * no provider is created.
 */
export function useBoardDoc(provided?: Y.Doc, boardId?: string): UseBoardDocResult {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = provided ?? new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const [connectionState, setConnectionState] = useState<ConnectionState | undefined>(undefined);
  const connectionRef = useRef<ConnectionHandle | null>(null);

  useEffect(() => {
    if (!boardId) return;
    const handle = connectBoard(doc, boardId, setConnectionState);
    connectionRef.current = handle;
    return () => {
      handle.destroy();
      connectionRef.current = null;
    };
  }, [doc, boardId]);

  // The snapshot cache lives outside React state: Yjs tells us when to refresh it.
  const cache = useRef<{ current: readonly StickySnapshot[] } | null>(null);
  if (cache.current === null) cache.current = { current: snapshot(doc) };
  const store = cache.current;

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');
      const observer = () => {
        const next = snapshot(doc);
        if (next !== store.current) store.current = next;
        onStoreChange();
      };
      objects.observeDeep(observer);
      return () => objects.unobserveDeep(observer);
    },
    [doc, store],
  );

  const getSnapshot = useCallback(() => store.current, [store]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { doc, notes, connectionState };
}
