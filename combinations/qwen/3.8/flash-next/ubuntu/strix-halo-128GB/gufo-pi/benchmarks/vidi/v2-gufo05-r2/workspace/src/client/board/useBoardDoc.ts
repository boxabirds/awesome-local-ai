import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';

import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { registerTestHooks } from '../canvas/testHooks';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

export interface BoardDoc {
  readonly doc: Y.Doc;
  readonly notes: readonly StickySnapshot[];
  /** Live connection to this board's room; see `connectBoard`. */
  readonly connection: ConnectionState;
}

/**
 * Owns the single in-memory `Y.Doc` for this page, keeps it initialised, keeps
 * it connected to one board's room, and exposes an immutable `StickySnapshot[]`
 * recomputed whenever the objects change (`observeDeep`) — which is how both
 * local and remote changes re-render. Story 4 will persist the same doc; no
 * component changes are needed then.
 */
export function useBoardDoc(boardId: string): BoardDoc {
  const doc = useMemo(() => {
    const next = new Y.Doc();
    initDoc(next);
    return next;
  }, []);

  const [connection, setConnection] = useState<ConnectionState>('connecting');
  // One connection per board: attaching it is what makes other people's changes
  // arrive, and destroying it when this board stops being displayed is what
  // keeps a page from listening to a room it has left.
  useEffect(() => {
    // `states` exists for tests: a state that came and went between two polls is
    // still in it, so "never said Reconnecting" can be checked after the fact.
    const states: ConnectionState[] = ['connecting'];
    const handle = connectBoard(doc, boardId, (next) => {
      states.push(next);
      setConnection(next);
    });
    registerTestHooks({
      connectionState: () => states[states.length - 1]!,
      connectionStates: () => [...states],
      connectionAttempts: () => handle.connectionAttempts(),
      disconnectBoard: () => handle.destroy(),
    });
    return () => handle.destroy();
  }, [doc, boardId]);

  // The snapshot is recomputed only when the objects map changes. `subscribe`
  // wires observeDeep; `getSnapshot` returns the cached value so React only
  // re-renders when the snapshot reference actually changes.
  const store = useMemo(() => {
    let current = snapshot(doc);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const listeners = new Set<() => void>();
    const emit = () => {
      current = snapshot(doc);
      for (const listener of listeners) listener();
    };
    return {
      subscribe(listener: () => void): () => void {
        if (listeners.size === 0) objects.observeDeep(emit);
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
          if (listeners.size === 0) objects.unobserveDeep(emit);
        };
      },
      getSnapshot: () => current,
    };
  }, [doc]);

  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { doc, notes, connection };
}
