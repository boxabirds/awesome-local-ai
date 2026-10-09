import { useCallback, useEffect, useSyncExternalStore, useRef, useState } from 'react';
import * as Y from 'yjs';
import {
  OBJECTS_MAP,
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import { registerTestHooks } from '../canvas/testHooks';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

export interface BoardDoc {
  /** The single document this page edits, local and shared at the same time. */
  readonly doc: Y.Doc;
  /** Sticky notes to render, sorted by `(z, id)`; unknown object types are skipped. */
  readonly notes: readonly StickySnapshot[];
  /** What the connection to this board's room is doing, for the status badge. */
  readonly connection: ConnectionState;
}

/**
 * Owns the board's `Y.Doc`, connects it to its room, and exposes it as an immutable
 * snapshot.
 *
 * `useSyncExternalStore` needs a cached snapshot, so the array is recomputed only when
 * `objects.observeDeep` fires — which includes nested `Y.Text` changes, which is how a
 * note's text reaches React while someone types. That is the same path a remote edit
 * takes: the provider applies an update, the observer fires, the board re-renders, so
 * nothing distinguishes your own change from somebody else's.
 */
export function useBoardDoc(boardId: string): BoardDoc {
  const [doc] = useState<Y.Doc>(() => {
    const fresh = new Y.Doc();
    initDoc(fresh);
    return fresh;
  });
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  // Read through a ref so the test hook always answers with the current state, however
  // long ago it was registered.
  const connectionRef = useRef<ConnectionState>(connection);
  connectionRef.current = connection;
  const objects = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);

  // Cached by hand: `snapshot()` allocates, and returning a new array on every call
  // would make `useSyncExternalStore` re-render forever.
  const cache = useRef<{ snapshot: readonly StickySnapshot[] } | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      const observer = (): void => {
        cache.current = null;
        onStoreChange();
      };
      objects.observeDeep(observer);
      return () => {
        cache.current = null;
        objects.unobserveDeep(observer);
      };
    },
    [objects],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    if (!cache.current) cache.current = { snapshot: snapshot(doc) };
    return cache.current.snapshot;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // The component and e2e tests assert the document itself (and story 3 needs the same
  // hook point), so it is exposed through the test-only hook.
  useEffect(() => {
    registerTestHooks({
      boardDoc: () => doc,
      connectionState: () => connectionRef.current,
    });
  }, [doc]);

  // One connection per document and board: leaving this board for another one (a new
  // link) tears the old one down instead of editing two boards from one document.
  useEffect(() => {
    const live = connectBoard(doc, boardId, setConnection);
    return () => {
      live.destroy();
    };
  }, [doc, boardId]);

  return { doc, notes, connection };
}
