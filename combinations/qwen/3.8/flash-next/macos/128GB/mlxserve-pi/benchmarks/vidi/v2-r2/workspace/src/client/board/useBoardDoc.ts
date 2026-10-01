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
import { initDoc, snapshotByCreation, type ObjectSnapshot, type StickySnapshot } from '../../shared/board-model';
import { textSnapshots, type TextSnapshot } from '../../shared/objects/text';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';
import {
  registerConnectionControl,
  registerConnectionForcer,
  registerConnectionState,
} from '../canvas/testHooks';

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
   * Renderable text objects (story 9), oldest first, in the same shape as `notes`.
   * They come out as their own list rather than merged into one so that a board
   * renders each type with the code that knows it; every operation that works on
   * "the objects" - select-all, the marquee, the transform gesture, the keyboard -
   * is handed the two lists together.
   */
  texts: readonly TextSnapshot[];
  /**
   * Every renderable object, notes first then texts, in creation order within each
   * type. The z order is each object's own business (they are drawn by `z`), so
   * this order is only the order the DOM is built in - which never changes while a
   * pointer is holding one of them.
   */
  objects: readonly ObjectSnapshot[];
  /**
   * Live collaboration state. Stays `connecting` for a standalone board with no
   * `boardId` (a component test, or the pre-network app), so nothing connects.
   */
  connection: ConnectionState;
}

/** Everything the board draws out of the document, in one object: the store's
 * snapshot has to be one value, because two lists that changed together have to
 * arrive in one render. */
export interface BoardObjects {
  notes: readonly StickySnapshot[];
  texts: readonly TextSnapshot[];
  objects: readonly ObjectSnapshot[];
}

interface SnapshotStore {
  readonly doc: Y.Doc;
  subscribe(onStoreChange: () => void): () => void;
  getSnapshot(): BoardObjects;
}

function createStore(injected: Y.Doc | undefined): SnapshotStore {
  const doc = injected ?? new Y.Doc();
  initDoc(doc);
  const objects = doc.getMap('objects');
  const listeners = new Set<() => void>();
  /** Cleared on any document change and rebuilt on the next read. */
  let cached: BoardObjects | null = null;

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
      if (cached === null) {
        const notes = snapshotByCreation(doc);
        const texts = textSnapshots(doc);
        cached = { notes, texts, objects: [...notes, ...texts] };
      }
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
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const { notes, texts, objects } = snapshot;

  const [connection, setConnection] = useState<ConnectionState>('connecting');
  useEffect(() => {
    // Registered whether or not there is a network: a component test that wants to
    // know what the board does while the room cannot read it says so, rather than
    // standing up a server that fails on purpose.
    registerConnectionForcer(setConnection);
    if (boardId === undefined) return () => registerConnectionForcer(null);
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
      registerConnectionForcer(null);
      live.destroy();
    };
  }, [store, boardId]);

  return { doc: store.doc, notes, texts, objects, connection };
}

/** Re-export so callers do not import Yjs just to type a prop. */
export type { StickySnapshot, TextSnapshot };
