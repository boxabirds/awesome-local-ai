import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

export interface BoardDocApi {
  /** The single Yjs document backing the board. */
  doc: Y.Doc;
  /** Board objects in render order `(z, id)`; unknown types are skipped. */
  notes: readonly StickySnapshot[];
  /** Live connection state (`'connecting'` forever when no board id is given). */
  connection: ConnectionState;
}

/**
 * Owns the board's `Y.Doc`, exposes it to React as an immutable snapshot and,
 * when a `boardId` is given, keeps it in sync with the other people on that
 * board.
 *
 * The document is created once per mount and `initDoc` runs on it. Changes are
 * observed with `objects.observeDeep`; the snapshot itself is memoised and
 * handed to `useSyncExternalStore`, so React re-renders at most once per batch
 * of Yjs changes and always reads a stable array reference between changes.
 * Remote updates arrive with the provider as their transaction origin and take
 * exactly the same path as local ones.
 *
 * The document is deliberately *not* destroyed on unmount (story 4 persists the
 * same document, and React's StrictMode double-mount must not discard board
 * content). The *provider* is destroyed: attaching and detaching it must never
 * lose local content, and a detached tab must stop talking to the room.
 */
export function useBoardDoc(existing?: Y.Doc, boardId?: string): BoardDocApi {
  const [created] = useState<Y.Doc>(() => {
    const doc = new Y.Doc();
    initDoc(doc);
    return doc;
  });
  const doc = existing ?? created;

  const [connection, setConnection] = useState<ConnectionState>('connecting');

  const cache = useRef<{ dirty: boolean; value: readonly StickySnapshot[] }>({
    dirty: true,
    value: [],
  });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');
      const observer = () => {
        cache.current.dirty = true;
        onStoreChange();
      };
      objects.observeDeep(observer);
      // Pick up changes made between the render and this subscription.
      cache.current.dirty = true;
      return () => objects.unobserveDeep(observer);
    },
    [doc],
  );

  const getSnapshot = useCallback(() => {
    if (cache.current.dirty) {
      cache.current = { dirty: false, value: snapshot(doc) };
    }
    return cache.current.value;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Live sync: one provider per board, torn down on unmount or board change.
  // Without a board id (component tests, future offline build) the board is a
  // local document only.
  useEffect(() => {
    if (!boardId || existing) {
      setConnection('connected');
      return;
    }
    const live = connectBoard(doc, boardId, setConnection);
    return () => live.destroy();
  }, [doc, boardId, existing]);

  return { doc, notes, connection };
}
