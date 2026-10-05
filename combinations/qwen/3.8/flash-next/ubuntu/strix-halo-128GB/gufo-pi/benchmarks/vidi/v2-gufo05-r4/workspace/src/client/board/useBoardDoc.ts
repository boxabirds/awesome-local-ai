/**
 * Owns the board's Yjs document for React.
 *
 * The document is the single source of truth, and the network is just another
 * writer to it: `connectBoard` attaches a provider to the same `Y.Doc`, remote
 * updates arrive through the same `observeDeep` subscription as local ones, and
 * the same snapshot code renders them. Story 4 persists the document and neither
 * the hook's callers nor the render path change.
 *
 * React reads an immutable snapshot through `useSyncExternalStore`, so all
 * rendering comes from one consistent read of the document and every write goes
 * through `src/shared/board-model.ts`.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

/** A store around one Y.Doc: the piece of state React subscribes to. */
export interface BoardStore {
  readonly doc: Y.Doc;
  /** The current snapshot; referentially stable until the document changes. */
  getSnapshot(): readonly StickySnapshot[];
  /** Subscribe to document changes; returns the unsubscribe function. */
  subscribe(onChange: () => void): () => void;
}

/**
 * Watches `objects` with `observeDeep`, which fires for the map itself and for
 * anything nested inside it — so moving a note, recolouring it and typing in it
 * all refresh the snapshot. The snapshot is recomputed once per document
 * transaction and cached, which keeps `getSnapshot` referentially stable (a
 * changing reference here would loop React forever).
 */
export function createBoardStore(source?: Y.Doc): BoardStore {
  const doc = source ?? new Y.Doc();
  initDoc(doc);
  let current: readonly StickySnapshot[] = snapshot(doc);
  const listeners = new Set<() => void>();

  const recompute = () => {
    current = snapshot(doc);
  };

  (doc.getMap('objects') as Y.Map<unknown>).observeDeep(() => {
    recompute();
    for (const listener of [...listeners]) listener();
  });

  return {
    doc,
    getSnapshot: () => current,
    subscribe: (onChange: () => void) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    }
  };
}

export interface BoardDoc {
  readonly doc: Y.Doc;
  /** Every renderable object, bottom to top (sorted by z, then id). */
  readonly notes: readonly StickySnapshot[];
  /** How the connection to this board's room looks right now. */
  readonly connection: ConnectionState;
}

export interface BoardDocOptions {
  /**
   * The board to join. Without it the document stays purely local — which is what
   * the component tests use — and the connection reads `connected`, so the status
   * badge never appears for work that was never meant to be shared.
   */
  boardId?: string;
  /** A document to use instead of making one (tests pass a private `Y.Doc`). */
  doc?: Y.Doc;
}

/**
 * The board document, a snapshot of its content and the state of its connection.
 *
 * The document is not thrown away on unmount, so a StrictMode remount finds the
 * same content; the *connection* is destroyed and re-made, because a provider owns
 * a socket and a socket must not outlive the component that asked for it.
 */
export function useBoardDoc(options: BoardDocOptions = {}): BoardDoc {
  const { boardId, doc: provided } = options;
  const store = useMemo<BoardStore>(() => createBoardStore(provided), [provided]);
  const subscribe = useCallback((onChange: () => void) => store.subscribe(onChange), [store]);
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const [connection, setConnection] = useState<ConnectionState>(boardId ? 'connecting' : 'connected');
  useEffect(() => {
    if (!boardId) {
      // A local-only document has no connection to report.
      setConnection('connected');
      return;
    }
    setConnection('connecting');
    const handle = connectBoard(store.doc, boardId, setConnection);
    return () => handle.destroy();
  }, [store, boardId]);

  return { doc: store.doc, notes, connection };
}
