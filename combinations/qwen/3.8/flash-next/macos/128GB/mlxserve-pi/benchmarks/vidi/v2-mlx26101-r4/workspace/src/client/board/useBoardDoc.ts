/**
 * Owns the board's `Y.Doc`, hands React an immutable snapshot of it, and keeps it
 * connected to the room other people are editing the same board in.
 *
 * The document — not React state — is the source of truth. Local edits and changes
 * that arrived from somebody else both land in the same document, so there is one
 * path to the screen: `objects.observeDeep` marks the cached snapshot dirty and the
 * next render reads the document again. A remote change is therefore not a special
 * case anywhere in the interface.
 *
 * Nothing here is stored anywhere: closing the page loses the notes, which is story
 * 4's job. The connection is only for as long as the board is on screen; leaving it
 * (or the board address changing) tears the connection down.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';

import { initDoc, snapshot } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { registerBoardForTests, registerConnectionForTests, reportConnectionStateForTests } from '../canvas/testHooks';
import { connectBoard } from '../sync/connectBoard';
import type { ConnectionState } from '../sync/connectBoard';

export interface BoardDoc {
  /** The document every board mutation is applied to. */
  doc: Y.Doc;
  /** The objects to render, in stacking order; frozen, new only after a change. */
  notes: readonly ObjectSnapshot[];
  /** Whether anybody else can see this board, as the badge reports it. */
  connection: ConnectionState;
}

/**
 * How a board document gets connected to a room; the real one is `connectBoard`.
 *
 * A connection that can be dropped is asked for, not required: a component test hands
 * in a connection that connects to nothing, and there is no socket in it to cut.
 */
export type BoardConnector = (
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
) => { destroy(): void; drop?(): void };

interface BoardDocStore {
  readonly doc: Y.Doc;
  subscribe(onStoreChange: () => void): () => void;
  getSnapshot(): BoardDoc;
  /** Connect this board, and hand back the one function that disconnects it. */
  connect(): () => void;
}

function createBoardDocStore(boardId: string, connect: BoardConnector): BoardDocStore {
  const doc = new Y.Doc();
  initDoc(doc);

  const listeners = new Set<() => void>();
  let cached: BoardDoc | null = null;
  // The board is not live until it has agreed with the room about its contents.
  let connection: ConnectionState = 'connecting';

  const notify = (): void => {
    cached = null; // dirty: the next getSnapshot recomputes
    for (const listener of [...listeners]) listener();
  };

  // Deep, so a colour change, a move and a keystroke in `text` all arrive.
  doc.getMap<Y.Map<unknown>>('objects').observeDeep(notify);

  // Tests read the document the app itself created, rather than a copy of it.
  // `MODE` is a build-time constant, so this disappears from production builds.
  if (import.meta.env.MODE === 'test') registerBoardForTests(doc);

  return {
    doc,
    subscribe(onStoreChange) {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    },
    connect() {
      const boardConnection = connect(doc, boardId, (state) => {
        if (state === connection) return;
        connection = state;
        if (import.meta.env.MODE === 'test') reportConnectionStateForTests(state);
        notify();
      });
      // An end-to-end test cuts one person off through this: Playwright can stop a page
      // making new connections but cannot touch one that is already open.
      if (import.meta.env.MODE === 'test') registerConnectionForTests(() => boardConnection.drop?.());
      return () => {
        if (import.meta.env.MODE === 'test') registerConnectionForTests(undefined);
        boardConnection.destroy();
      };
    },
    getSnapshot() {
      if (!cached) cached = { doc, notes: snapshot(doc), connection };
      return cached;
    },
  };
}

/**
 * One `Y.Doc` per board, re-rendered whenever the document changes — including when
 * the change came from someone else's screen.
 *
 * The store is held in a ref rather than created in a `useMemo` so React cannot
 * hand out two documents (StrictMode re-invokes renders, and a second `Y.Doc` would
 * silently split the board). The connection is opened in an effect instead, because
 * that is the one place React guarantees to close again: opening a socket while
 * React is rendering would leave a connection to somebody else's board behind.
 */
export function useBoardDoc(boardId: string, connect: BoardConnector = connectBoard): BoardDoc {
  const storeRef = useRef<{ boardId: string; connect: BoardConnector; store: BoardDocStore } | null>(
    null,
  );
  const existing = storeRef.current;
  let held = existing;
  if (held === null || held.boardId !== boardId || held.connect !== connect) {
    held = { boardId, connect, store: createBoardDocStore(boardId, connect) };
    storeRef.current = held;
  }
  const store = held.store;

  useEffect(() => store.connect(), [store]);

  const subscribe = useCallback((onStoreChange: () => void) => store.subscribe(onStoreChange), [store]);
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
