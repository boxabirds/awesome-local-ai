/**
 * Owns the board's Yjs document for React.
 *
 * Story 2 keeps the document in memory only: story 3 attaches a network provider
 * to the same `Y.Doc`, story 4 persists it, and neither needs to change this
 * hook. React reads an immutable snapshot through `useSyncExternalStore`, so all
 * rendering comes from one consistent read of the document and every write goes
 * through `src/shared/board-model.ts`.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

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
}

/**
 * The board document and a snapshot of its content. Without `provided` the hook
 * makes a document of its own; nothing is thrown away on unmount, so a StrictMode
 * remount finds the same content (story 4 is where a document is loaded from
 * storage instead).
 *
 * @param provided a document to use — tests pass a private `Y.Doc` they can assert
 *   on, and story 3 passes the one that is synced with the room.
 */
export function useBoardDoc(provided?: Y.Doc): BoardDoc {
  const store = useMemo<BoardStore>(() => createBoardStore(provided), [provided]);
  const subscribe = useCallback((onChange: () => void) => store.subscribe(onChange), [store]);
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { doc: store.doc, notes };
}
