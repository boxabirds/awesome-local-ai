/**
 * Story 2 · task 2 — the `useBoardDoc` hook; Story 3 · task 4 — live provider.
 *
 * Owns one `Y.Doc`, keeps an immutable `StickySnapshot[]` in sync with it and
 * hands that to React through `useSyncExternalStore`. The Y.Doc is the single
 * source of truth.
 *
 * Story 3 adds the network provider: when a `boardId` is supplied, a
 * `WebsocketProvider` (via `connectBoard`) is attached to the same document and
 * torn down on unmount / board change, and the mapped `ConnectionState` is
 * exposed for the badge. Remote updates re-render through the existing
 * `observeDeep` subscription — the merge happens in Yjs, not here. With no
 * `boardId` (component tests) there is no provider and the state is a
 * permanently-hidden `connected`.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard } from '../sync/connectBoard';
import type { ConnectionState } from '../sync/connectionState';

interface SnapshotStore {
  doc: Y.Doc;
  getSnapshot(): readonly StickySnapshot[];
  subscribe(onStoreChange: () => void): () => void;
}

/**
 * Keep a memoised snapshot aligned with the document. `observeDeep` fires for
 * any change to `objects` or any nested Y.Map / Y.Text, so a text edit, a
 * move, a recolour or an add/delete all recompute the snapshot. The array
 * identity only changes on a real change, so React never re-renders in a loop.
 */
function createStore(doc: Y.Doc): SnapshotStore {
  let current = snapshot(doc);
  const listeners = new Set<() => void>();
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const notify = () => {
    current = snapshot(doc);
    for (const listener of listeners) listener();
  };
  objects.observeDeep(notify);
  return {
    doc,
    getSnapshot: () => current,
    subscribe(onStoreChange) {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    },
  };
}

export interface BoardDoc {
  doc: Y.Doc;
  /** Notes sorted by (z, id); the render order. */
  notes: readonly StickySnapshot[];
  /** Current live-connection state; `'connected'` when offline / no provider. */
  connectionState: ConnectionState;
}

/**
 * Create (or adopt) the board document and subscribe to it. When `external` is
 * supplied (component tests) it is used as-is; otherwise a fresh, empty
 * document is created. When `boardId` is supplied a provider is attached to
 * that document and the connection state is tracked.
 */
export function useBoardDoc(external?: Y.Doc, boardId?: string): BoardDoc {
  const ref = useRef<{ doc: Y.Doc; store: SnapshotStore } | null>(null);
  if (ref.current === null || (external !== undefined && ref.current.doc !== external)) {
    const doc = external ?? new Y.Doc();
    if (external === undefined) initDoc(doc);
    ref.current = { doc, store: createStore(doc) };
  }
  const { doc, store } = ref.current;
  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  // A single state drives both the badge and, in test builds, the
  // `window.__vidi6.connectionState` assertion hook (story 3 nightly tests).
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    boardId === undefined ? 'connected' : 'connecting',
  );

  useEffect(() => {
    if (boardId === undefined) {
      setConnectionState('connected');
      return;
    }
    setConnectionState('connecting');
    const connection = connectBoard(doc, boardId, setConnectionState);
    return () => connection.destroy();
    // `doc` is stable for the lifetime of the shell (it is created once in the
    // ref above), so the provider is only rebuilt when the board changes.
  }, [doc, boardId]);

  return { doc, notes, connectionState };
}