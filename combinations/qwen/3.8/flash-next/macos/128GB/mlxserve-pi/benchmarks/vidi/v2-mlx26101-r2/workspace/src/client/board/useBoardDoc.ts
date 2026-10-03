import { useCallback, useMemo, useSyncExternalStore, useState, useEffect } from 'react';

import * as Y from 'yjs';

import { clearBoardTestHooks, publishConnectionState, registerBoardTestHooks } from '../canvas/testHooks.js';
import { connectBoard } from '../sync/connectBoard.js';
import type { BoardConnection, ConnectionState } from '../sync/connectBoard.js';
import {
  DOC_OBJECTS_MAP,
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../shared/board-model.js';

/** How a board gets its connection; tests hand in a fake (see `connectBoard`). */
export type BoardConnector = (
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
) => BoardConnection;

/** What the hook exposes to the app. */
export interface UseBoardDocResult {
  /** The one document of this visit, shared with everyone on this board. */
  doc: Y.Doc;
  /** Every note, sorted by (z, id); a new array only when the doc changed. */
  notes: readonly StickySnapshot[];
  /** The connection badge's state; `connecting` until this room is reached. */
  connection: ConnectionState;
}

/**
 * Snapshot cache per document, so `useSyncExternalStore` sees a stable value
 * between renders and recomputes only after an actual document change. Keyed
 * by the document (a WeakMap) rather than by the component, because React's
 * StrictMode renders the same document through two hook instances.
 */
const caches = new WeakMap<Y.Doc, { notes: readonly StickySnapshot[] | null }>();

const cacheFor = (doc: Y.Doc): { notes: readonly StickySnapshot[] | null } => {
  let cache = caches.get(doc);
  if (!cache) {
    cache = { notes: null };
    caches.set(doc, cache);
  }
  return cache;
};

/**
 * Owns the board's `Y.Doc` and republishes it as an immutable snapshot through
 * `useSyncExternalStore` (design `board.model`: "snapshot is memoised by
 * useBoardDoc and recomputed on objects.observeDeep"), and attaches the board's
 * connection to it (design "sync.client").
 *
 * The document is the source of truth for board content: everything the user
 * types, moves or deletes goes into it and goes out through the provider, and
 * everything a remote edit does arrives through the same document. Nothing is
 * stored yet - that is story 4 - so a board starts empty every time it is
 * opened.
 */
export function useBoardDoc(
  boardId: string,
  connect: BoardConnector = connectBoard,
): UseBoardDocResult {
  // useState's initialiser is the one place React guarantees runs once per
  // mounted component, so the document survives re-renders.
  const [doc] = useState<Y.Doc>(() => {
    const fresh = new Y.Doc();
    initDoc(fresh);
    return fresh;
  });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap<Y.Map<unknown>>(DOC_OBJECTS_MAP);
      const handler = () => {
        // Any change to any object (including a note's Y.Text) invalidates the
        // cached snapshot.
        cacheFor(doc).notes = null;
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
    const cache = cacheFor(doc);
    if (cache.notes === null) cache.notes = snapshot(doc);
    return cache.notes;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // The connection badge's state. It starts at 'connecting' because that is
  // what it says from the first render: the provider has not reached the room
  // yet. connectBoard reports every later change.
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  useEffect(() => {
    const board = connect(doc, boardId, setConnection);
    return () => board.destroy();
  }, [connect, doc, boardId]);

  // Test-only view of the document (test mode only): tests assert the document
  // itself, and can delete a note "through the model" the way a second client
  // would, instead of only looking at the rendered DOM.
  useEffect(() => {
    registerBoardTestHooks({
      getDoc: () => doc,
      getNotes: () => snapshot(doc),
      getBoardId: () => boardId,
    });
    return () => clearBoardTestHooks();
  }, [doc, boardId]);

  // e2e-only: the connection state the badge is showing (test mode only).
  useEffect(() => {
    publishConnectionState(connection);
  }, [connection]);

  return useMemo<UseBoardDocResult>(
    () => ({ doc, notes, connection }),
    [doc, notes, connection],
  );
}
