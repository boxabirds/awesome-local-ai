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

import {
  initDoc,
  objectSnapshots,
  snapshot,
  OBJECTS_KEY,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';
import { installTestHooks, IS_TEST_MODE } from '../canvas/testHooks';

export interface BoardDocHandle {
  readonly doc: Y.Doc;
  /** Notes in stacking order (z, id); frozen so React can compare by identity. */
  readonly notes: readonly StickySnapshot[];
  /**
   * Every object on the board, of every type this build can read, in stacking order.
   *
   * This is what the board draws and what the selection works on. It is not filtered
   * by the object registry here — reading a type is the shared model's business, and
   * drawing one is the client's — because a component that cannot draw an object must
   * still be able to see that it exists. `App` does the filtering, once, and the
   * selection, the marquee and select-all are built from what is left.
   */
  readonly objects: readonly ObjectSnapshot[];
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
  getObjects(): readonly ObjectSnapshot[];
}

/**
 * Cheap structural comparison of two object lists, so a change that altered nothing
 * keeps the cached identity and the board does not re-render every object.
 *
 * Width and height are in here because story 7 made them real: a resize is a change to
 * the document, and a snapshot comparison that ignored it would leave the board drawing
 * the old size until something else happened to move.
 */
function sameObjects(left: readonly ObjectSnapshot[], right: readonly ObjectSnapshot[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((object, index) => {
    const other = right[index];
    if (!other) return false;
    if (
      other.id !== object.id ||
      other.type !== object.type ||
      other.x !== object.x ||
      other.y !== object.y ||
      other.width !== object.width ||
      other.height !== object.height ||
      other.z !== object.z
    ) {
      return false;
    }
    // A sticky note carries its text and colour, and typing must re-render too. A shape
    // carries its label and colours, and those must re-render for the same reason — the
    // generic base fields (x/y/width/height/z) are unchanged when only a label is typed.
    // Any other type has nothing beyond the base to compare.
    // A discriminated-union member has a literal `type`, so `StickySnapshot & ShapeSnapshot`
    // would collapse to `never`; read the few type-specific fields through a loose shape.
    type Extra = {
      text?: string;
      color?: string;
      label?: string;
      fill?: string;
      stroke?: string;
    };
    const mine = object as Extra;
    const theirs = other as Extra;
    if (mine.text !== theirs.text || mine.color !== theirs.color) return false;
    if (mine.label !== theirs.label || mine.fill !== theirs.fill || mine.stroke !== theirs.stroke) return false;
    return true;
  });
}

/** Create the store behind the hook: doc + memoised snapshot + subscription. */
export function createBoardStore(doc: Y.Doc = new Y.Doc()): BoardStore {
  initDoc(doc);
  const objects = doc.getMap(OBJECTS_KEY);
  const listeners = new Set<() => void>();
  let cached: readonly StickySnapshot[] = snapshot(doc);
  let cachedObjects: readonly ObjectSnapshot[] = objectSnapshots(doc);
  let attached = false;

  /** Recompute both lists: they are read off the same document, in the same breath. */
  const refresh = () => {
    const next = snapshot(doc);
    if (!sameObjects(cached, next)) cached = next;
    const nextObjects = objectSnapshots(doc);
    if (!sameObjects(cachedObjects, nextObjects)) cachedObjects = nextObjects;
  };

  const handleDocumentChange = () => {
    refresh();
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
      refresh();
      return () => {
        listeners.delete(onStoreChange);
        if (listeners.size === 0 && attached) {
          objects.unobserveDeep(handleDocumentChange);
          attached = false;
        }
      };
    },
    getSnapshot: () => cached,
    getObjects: () => cachedObjects,
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
  const objects = useSyncExternalStore(store.subscribe, store.getObjects, store.getObjects);
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
    () => ({ doc: store.doc, notes, objects, connectionState }),
    [store, notes, objects, connectionState],
  );
}
