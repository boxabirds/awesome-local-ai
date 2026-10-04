import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { OBJECTS_MAP, initDoc, snapshot } from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

/**
 * The board document plus the notes it contains.
 *
 * The document is the single source of truth for board content; React never owns it.
 * `notes` is an immutable snapshot recomputed only when `objects` (or anything inside it)
 * changes, which is what `useSyncExternalStore` needs: a stable value between changes, so
 * rendering never re-derives the list.
 *
 * `connection` says what the room this document syncs with is doing. Edits go into the
 * document whether or not it says `connected`, which is why the board keeps working through
 * an interruption.
 */
export interface BoardDoc {
  readonly doc: Y.Doc;
  /** Notes in render order (by `z`, then id). */
  readonly notes: readonly StickySnapshot[];
  /** What the connection to the board's room is doing. */
  readonly connection: ConnectionState;
}

interface DocStore {
  readonly doc: Y.Doc;
  subscribe(onStoreChange: () => void): () => void;
  getSnapshot(): readonly StickySnapshot[];
  /** Start observing the document (called on mount). */
  attach(): void;
  /** Stop observing the document (called on unmount). */
  detach(): void;
}

function createStore(injected?: Y.Doc): DocStore {
  const doc = injected ?? new Y.Doc();
  initDoc(doc);

  const listeners = new Set<() => void>();
  let current: readonly StickySnapshot[] = snapshot(doc);
  let observer: ((events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => void) | null =
    null;

  const notify = (): void => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    doc,
    subscribe(onStoreChange) {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    },
    getSnapshot() {
      return current;
    },
    attach() {
      if (observer !== null) {
        return;
      }
      // Deep: a change to a note's Y.Text is as much a change to the board as a move.
      observer = () => {
        current = snapshot(doc);
        notify();
      };
      doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).observeDeep(observer);
      // Changes that happened while detached are not missed.
      current = snapshot(doc);
    },
    detach() {
      if (observer === null) {
        return;
      }
      doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).unobserveDeep(observer);
      observer = null;
    },
  };
}

/**
 * Own the board document for this component, and keep it in sync with the board's room.
 *
 * @param boardId the board to sync with. Left out, the document is not connected to anything,
 * which is what a component test does with a document of its own.
 * @param initialDoc optional document to use instead of creating one. Tests pass their own so
 * they can drive the model directly; production calls leave it out.
 *
 * The connection belongs to this component: it is opened when the component mounts and hung up
 * when it goes away or when the address moves to a different board, so a tab never sends one
 * board's edits into another board's room.
 */
export function useBoardDoc(boardId?: string, initialDoc?: Y.Doc): BoardDoc {
  const ref = useRef<DocStore | null>(null);
  if (ref.current === null) {
    ref.current = createStore(initialDoc);
  }
  const store = ref.current;
  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  useEffect(() => {
    store.attach();
    return () => {
      store.detach();
    };
  }, [store]);

  useEffect(() => {
    if (boardId === undefined) {
      return;
    }
    setConnection('connecting');
    // Remote edits arrive as document updates and re-render the board through the same
    // observer as local ones; nothing here has to know who made a change.
    const handle = connectBoard(store.doc, boardId, setConnection);
    return () => {
      handle.destroy();
    };
  }, [store, boardId]);

  return { doc: store.doc, notes, connection };
}
