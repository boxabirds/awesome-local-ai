// Story 2: owns the local Y.Doc and exposes an immutable snapshot of the
// board to React via useSyncExternalStore (anchor: board.model).
//
// Story 3: the hook now takes a board id, connects the doc to the room for
// that board (connectBoard), and surfaces the mapped connection state. The
// snapshot machinery is unchanged; a new doc is created per board id.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import {
  connectBoard,
  type ConnectionState,
} from '../sync/connectBoard';

export interface BoardDoc {
  /** The shared document (all mutations go through board-model). */
  doc: Y.Doc;
  /** Immutable snapshot of all sticky notes, sorted by (z, id). */
  notes: readonly StickySnapshot[];
  /** Mapped provider state (drives the live badge). */
  connectionState: ConnectionState;
}

// Module-level memo for useSyncExternalStore: getSnapshot must return the
// same reference between store changes, so the snapshot is recomputed only
// when the document actually changes (invalidated by the observeDeep below).
const snapshotCache = new Map<Y.Doc, readonly StickySnapshot[]>();

export function useBoardDoc(boardId: string): BoardDoc {
  // One doc per board id. (The previous doc is abandoned when the id
  // changes; its provider is destroyed by the effect cleanup below, so it
  // is garbage-collected.)
  const doc = useMemo(() => {
    const d = new Y.Doc();
    initDoc(d);
    return d;
  }, [boardId]);

  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  // Connect the doc to its room; the state machine reports via setConnectionState.
  useEffect(() => {
    setConnectionState('connecting');
    const handle = connectBoard(doc, boardId, setConnectionState);
    return () => {
      handle.destroy();
    };
  }, [doc, boardId]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = (): void => {
        snapshotCache.delete(doc);
        onStoreChange();
      };
      objects.observeDeep(handler);
      return () => {
        objects.unobserveDeep(handler);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    let notes = snapshotCache.get(doc);
    if (notes === undefined) {
      notes = snapshot(doc);
      snapshotCache.set(doc, notes);
    }
    return notes;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot);
  return { doc, notes, connectionState };
}
