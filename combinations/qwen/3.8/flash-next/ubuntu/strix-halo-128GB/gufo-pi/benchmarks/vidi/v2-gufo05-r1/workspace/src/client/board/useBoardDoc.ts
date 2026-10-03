/**
 * The React binding for the board document.
 *
 * One `Y.Doc` per board lives here for the lifetime of the component; every
 * mutation goes through `src/shared/board-model.ts`, and React renders an
 * immutable snapshot of it. The snapshot is recomputed only when the document
 * actually changes (`observeDeep`), and cached so `useSyncExternalStore` sees a
 * stable value between renders.
 *
 * Story 3 attaches a network provider to this same doc and story 4 persists it;
 * nothing about rendering changes when they do: a remote change is just another
 * `observeDeep` callback.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';

import { initDoc, snapshot, OBJECTS_KEY, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';
import { installTestHooks, IS_TEST_MODE } from '../canvas/testHooks';

export interface BoardDocHandle {
  readonly doc: Y.Doc;
  /** Notes in stacking order (z, id); frozen so React can compare by identity. */
  readonly notes: readonly StickySnapshot[];
  /**
   * What the connection to this board's room is doing. `connected` when the board
   * has no room at all (no `boardId`: a purely local document, which is what the
   * story 2 tests render), so nothing is reported about a connection that is not
   * being made.
   */
  readonly connectionState: ConnectionState;
}

interface BoardStore {
  readonly doc: Y.Doc;
  subscribe(onStoreChange: () => void): () => void;
  getSnapshot(): readonly StickySnapshot[];
}

/** Cheap structural comparison, so a no-op change keeps the cached identity. */
function sameNotes(
  left: readonly StickySnapshot[],
  right: readonly StickySnapshot[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((note, index) => {
    const other = right[index];
    return (
      !!other &&
      other.id === note.id &&
      other.x === note.x &&
      other.y === note.y &&
      other.z === note.z &&
      other.color === note.color &&
      other.text === note.text &&
      other.createdAt === note.createdAt
    );
  });
}

/** Create the store behind the hook: doc + memoised snapshot + subscription. */
export function createBoardStore(doc: Y.Doc = new Y.Doc()): BoardStore {
  initDoc(doc);
  const objects = doc.getMap(OBJECTS_KEY);
  const listeners = new Set<() => void>();
  let cached: readonly StickySnapshot[] = snapshot(doc);
  let attached = false;

  const handleDocumentChange = () => {
    const next = snapshot(doc);
    if (!sameNotes(cached, next)) cached = next;
    for (const listener of listeners) listener();
  };

  return {
    doc,
    subscribe(onStoreChange) {
      listeners.add(onStoreChange);
      if (!attached) {
        objects.observeDeep(handleDocumentChange);
        attached = true;
      }
      // Pick up anything written between the render and this subscription.
      const next = snapshot(doc);
      if (!sameNotes(cached, next)) cached = next;
      return () => {
        listeners.delete(onStoreChange);
        if (listeners.size === 0 && attached) {
          objects.unobserveDeep(handleDocumentChange);
          attached = false;
        }
      };
    },
    getSnapshot: () => cached,
  };
}

/**
 * The board's document, its notes and the state of its connection.
 *
 * `boardId` is what the person is looking at, from `/b/:boardId`; without it the
 * document stays local. Pass a doc to render one that already exists (component
 * tests); otherwise a fresh one is created.
 *
 * The provider belongs to the board, not to the render: changing `boardId` tears
 * one connection down and opens the next, and unmounting closes it. Everything
 * typed meanwhile is in the doc, which is what makes it survivable.
 */
export function useBoardDoc(boardId?: string, existing?: Y.Doc): BoardDocHandle {
  const [store] = useState<BoardStore>(() => createBoardStore(existing));
  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    boardId === undefined || boardId === '' ? 'connected' : 'connecting',
  );

  useEffect(() => {
    if (boardId === undefined || boardId === '') return;
    const connection = connectBoard(store.doc, boardId, setConnectionState);
    if (IS_TEST_MODE) {
      // An e2e test that wants the board to experience a dead connection needs a
      // close event, which a browser going offline does not deliver promptly.
      installTestHooks({
        goOffline: () => connection.goOffline(),
        goOnline: () => connection.goOnline(),
      });
    }
    return () => {
      connection.destroy();
    };
  }, [boardId, store.doc]);

  return useMemo(
    () => ({ doc: store.doc, notes, connectionState }),
    [store, notes, connectionState],
  );
}
