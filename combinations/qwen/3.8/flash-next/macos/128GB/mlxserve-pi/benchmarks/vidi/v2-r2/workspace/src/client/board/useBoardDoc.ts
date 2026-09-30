// Owns the board's Y.Doc and republishes it to React as an immutable snapshot
// through useSyncExternalStore. Nothing in React calls Yjs mutations directly;
// components call the board-model functions with `doc` and this hook re-renders
// them from the new snapshot.
//
// Story 3 attaches the network provider to this same document and story 4
// persists it, which is why the document lives here rather than in a useState
// of some component.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshotByCreation, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';
import { registerConnectionControl, registerConnectionState } from '../canvas/testHooks';

export interface BoardDocApi {
  /** The document every mutation is applied to. */
  doc: Y.Doc;
  /**
   * Renderable notes, oldest first, stable until the document changes. Each one
   * is drawn at its own `z`, so raising a note changes a number rather than
   * moving the element the user may be holding.
   */
  notes: readonly StickySnapshot[];
  /**
   * Live collaboration state. Stays `connecting` for a standalone board with no
   * `boardId` (a component test, or the pre-network app), so nothing connects.
   */
  connection: ConnectionState;
}

interface SnapshotStore {
  readonly doc: Y.Doc;
  subscribe(onStoreChange: () => void): () => void;
  getSnapshot(): readonly StickySnapshot[];
}

function createStore(injected: Y.Doc | undefined): SnapshotStore {
  const doc = injected ?? new Y.Doc();
  initDoc(doc);
  const objects = doc.getMap('objects');
  const listeners = new Set<() => void>();
  /** Cleared on any document change and rebuilt on the next read. */
  let cached: readonly StickySnapshot[] | null = null;

  const handle = (): void => {
    cached = null;
    for (const listener of [...listeners]) listener();
  };

  return {
    doc,
    subscribe(onStoreChange) {
      const first = listeners.size === 0;
      listeners.add(onStoreChange);
      if (first) objects.observeDeep(handle);
      return () => {
        listeners.delete(onStoreChange);
        if (listeners.size === 0) objects.unobserveDeep(handle);
      };
    },
    getSnapshot() {
      if (cached === null) cached = snapshotByCreation(doc);
      return cached;
    },
  };
}

/**
 * The board document and its notes. `doc` lets a test (or, later, the story 4
 * client) supply the document; without it the hook owns a fresh one. When a
 * `boardId` is given the same document is attached to its room and shared live;
 * the connection is torn down on unmount but the document is left intact.
 */
export function useBoardDoc(injected?: Y.Doc, boardId?: string): BoardDocApi {
  const [store] = useState(() => createStore(injected));
  const subscribe = useCallback((onStoreChange: () => void) => store.subscribe(onStoreChange), [store]);
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const [connection, setConnection] = useState<ConnectionState>('connecting');
  useEffect(() => {
    if (boardId === undefined) return;
    // Record every mapped state into the page-level log (a plain JS value the
    // badge's MutationObserver cannot watch), then surface it to React.
    const onState = (state: ConnectionState): void => {
      registerConnectionState(state);
      setConnection(state);
    };
    const live = connectBoard(store.doc, boardId, onState);
    registerConnectionControl({
      drop: () => live.drop(),
      restore: () => live.restore(),
      awarenessPresent: () => live.awarenessPresent(),
      reconnectCount: () => live.reconnectAttempts(),
      destroy: () => live.destroy(),
    });
    return () => {
      registerConnectionControl(null);
      live.destroy();
    };
  }, [store, boardId]);

  return { doc: store.doc, notes, connection };
}

/** Re-export so callers do not import Yjs just to type a prop. */
export type { StickySnapshot };
