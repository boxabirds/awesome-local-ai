import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, allObjectsSnapshot, type CombinedSnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState, type ConnectionHandle } from '../sync/connectBoard';

export interface UseBoardDocResult {
  /** The board's shared document (story 3 attaches a provider, story 4 persists it). */
  doc: Y.Doc;
  /** Render model: all objects sorted by `(z, id)`; identity is stable until a change. */
  notes: readonly CombinedSnapshot[];
  /** Connection state (undefined when no boardId is provided, e.g. in tests). */
  connectionState: ConnectionState | undefined;
}

/**
 * Owns the single `Y.Doc` of this page and exposes all objects to React through
 * `useSyncExternalStore`. The snapshot is recomputed only when the `objects` map (or
 * anything inside it) changes, so unrelated renders reuse the same immutable array.
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
  const cache = useRef<{ current: readonly CombinedSnapshot[] } | null>(null);
  if (cache.current === null) cache.current = { current: allObjectsSnapshot(doc) };
  const store = cache.current;

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');
      const observer = () => {
        const next = allObjectsSnapshot(doc);
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
