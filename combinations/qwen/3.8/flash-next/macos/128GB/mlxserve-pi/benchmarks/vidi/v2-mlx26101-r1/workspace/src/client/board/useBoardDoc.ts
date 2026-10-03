import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import {
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import {
  connectBoard,
  type ConnectionState,
} from '../sync/connectBoard';
import { installBoardHandle } from '../canvas/testHooks';

export interface BoardDoc {
  /** The live Y.Doc, shared with the room when a `boardId` was given. */
  doc: Y.Doc;
  /**
   * Immutable render model derived from the document, sorted by (z, id). A new
   * array reference is produced only when the document actually changes, so it
   * is a valid `useSyncExternalStore` snapshot. Remote updates arrive with the
   * provider as origin and re-render through the same observer as local ones.
   */
  notes: readonly StickySnapshot[];
  /**
   * What the connection badge shows. A board without a `boardId` is local-only
   * and reported as `connected`, so it never claims to be reconnecting.
   */
  connectionState: ConnectionState;
}

/**
 * Owns a single in-memory `Y.Doc` for the board and exposes an immutable
 * snapshot to React. The snapshot is memoised and recomputed only when the
 * objects map (or any nested object, including a note's Y.Text) changes, so
 * `useSyncExternalStore` never sees a spurious new reference.
 */
export function useBoardDoc(boardId?: string): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  // Cache the snapshot so getSnapshot returns a stable reference between
  // document changes; only the observer recomputes it.
  const cacheRef = useRef<readonly StickySnapshot[] | null>(null);
  if (cacheRef.current === null) cacheRef.current = snapshot(doc);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const observer = () => {
        cacheRef.current = snapshot(doc);
        onStoreChange();
      };
      objects.observeDeep(observer);
      return () => objects.unobserveDeep(observer);
    },
    [doc],
  );

  const getSnapshot = useCallback(
    () => cacheRef.current as readonly StickySnapshot[],
    [],
  );

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const [connectionState, setConnectionState] = useState<ConnectionState>(() =>
    boardId ? 'connecting' : 'connected',
  );

  // Expose the document to e2e tests for seed data and volume; a no-op (and
  // tree-shaken away) in production builds.
  useEffect(() => installBoardHandle(doc), [doc]);

  // Attach the room for this board, and detach it when the board changes or the
  // board goes away. Everything typed while disconnected stays in this doc and is
  // sent as soon as the provider reconnects; the doc is never thrown away.
  useEffect(() => {
    if (!boardId) {
      setConnectionState('connected');
      return;
    }
    setConnectionState('connecting');
    const connection = connectBoard(doc, boardId, setConnectionState);
    return () => connection.destroy();
  }, [doc, boardId]);

  return { doc, notes, connectionState };
}
