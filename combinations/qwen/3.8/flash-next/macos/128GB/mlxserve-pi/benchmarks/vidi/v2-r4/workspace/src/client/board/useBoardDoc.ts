import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';

import { connectBoard, type ConnectionState } from '../sync/connectBoard';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface BoardDocOptions {
  /** Board to join; without one the document stays local to this tab. */
  boardId?: string;
  /** Document to use instead of creating one (tests). */
  doc?: Y.Doc;
}

export interface BoardDoc {
  /** The document this client owns, connected to the board by a provider. */
  doc: Y.Doc;
  /** Immutable snapshot of every known object, sorted for painting. */
  notes: readonly StickySnapshot[];
  /** How this tab's connection to the board is doing. */
  connectionState: ConnectionState;
}

/**
 * Owns the board's `Y.Doc` and republishes `snapshot()` as a React store.
 *
 * The snapshot is memoised: `objects.observeDeep` marks it dirty and the next
 * `getSnapshot` recomputes it once, so `useSyncExternalStore` always compares
 * stable references and only re-renders when the document actually changed.
 * Observing with `observeDeep` (rather than `observe`) is what makes changes
 * inside a note — its `Y.Text`, its colour — visible here, which is exactly the
 * subscription story 3 needs for remote edits: a remote update arrives through
 * the provider, `observeDeep` fires and the snapshot is recomputed.
 *
 * With a `boardId` the document is connected to that board and the connection is
 * torn down on unmount or when the board changes, so a tab never keeps two
 * connections to the same document.
 */
export function useBoardDoc({ boardId, doc: provided }: BoardDocOptions = {}): BoardDoc {
  const doc = useMemo(() => {
    const created = provided ?? new Y.Doc();
    initDoc(created);
    return created;
  }, [provided]);

  // Wrapped in an object so "not computed" is distinguishable from a snapshot
  // of no notes.
  const cache = useRef<{ value: readonly StickySnapshot[] } | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const observer = () => {
        cache.current = null;
        onStoreChange();
      };
      objects.observeDeep(observer);
      return () => objects.unobserveDeep(observer);
    },
    [doc],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    if (cache.current === null) cache.current = { value: snapshot(doc) };
    return cache.current.value;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  useEffect(() => {
    if (boardId === undefined) return;
    const connection = connectBoard(doc, boardId, setConnectionState);
    return () => connection.destroy();
  }, [boardId, doc]);

  return useMemo(
    () => ({ doc, notes, connectionState }),
    [connectionState, doc, notes],
  );
}
