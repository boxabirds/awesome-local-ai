import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState, type ConnectBoardOptions } from '../sync/connectBoard';

/**
 * An immutable snapshot store backed by one Y.Doc. The snapshot is recomputed
 * only when the document actually changes (via `objects.observeDeep`), so
 * `getSnapshot` returns a referentially stable value between changes — the
 * invariant `useSyncExternalStore` requires.
 */
export interface BoardStore {
  doc: Y.Doc;
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly StickySnapshot[];
}

function createBoardStore(): BoardStore {
  const doc = new Y.Doc();
  initDoc(doc);
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  let current = snapshot(doc);
  const listeners = new Set<() => void>();

  // One deep observer drives every snapshot refresh (positions, colours, text
  // and add/remove all live under `objects`). Remote updates go through the
  // same path, so a synced change re-renders like a local one.
  const observer = () => {
    current = snapshot(doc);
    listeners.forEach((l) => l());
  };
  objects.observeDeep(observer);

  return {
    doc,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return current;
    },
  };
}

export interface UseBoardDocResult {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  /** Live connection state of the board's sync provider ('connected' when
   * there is no provider at all, e.g. component tests). */
  connectionState: ConnectionState;
}

/**
 * Owns one Y.Doc (plus, from story 3, the board's WebsocketProvider) for the
 * component's lifetime and exposes its latest snapshot and connection state.
 *
 * `boardId` selects the room: null (or the `VITE_NO_SYNC` test switch) means
 * "local only" — no provider, no network. StrictMode's double-effect keeps
 * exactly one provider because the effect teardown destroys it, and a boardId
 * change destroys the old provider before the next one connects.
 */
export function useBoardDoc(
  boardId: string | null,
  connectOptions: ConnectBoardOptions = {},
): UseBoardDocResult {
  const ref = useRef<BoardStore | null>(null);
  if (ref.current === null) ref.current = createBoardStore();
  const store = ref.current;

  const syncDisabled =
    import.meta.env.VITE_NO_SYNC === '1' || typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined';

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    boardId === null || syncDisabled ? 'connected' : 'connecting',
  );

  // Keep the injected provider factory stable across renders (StrictMode
  // re-runs effects; a changing factory would thrash the connection).
  const optionsRef = useRef(connectOptions);
  optionsRef.current = connectOptions;

  useEffect(() => {
    if (boardId === null || syncDisabled) return;
    const handle = connectBoard(store.doc, boardId, setConnectionState, optionsRef.current);
    return () => {
      handle.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, syncDisabled]);

  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return { doc: store.doc, notes, connectionState };
}
