// Owns the local Y.Doc for the board and exposes an immutable, memoised
// snapshot to React via useSyncExternalStore. Story 3 attaches a network
// provider to the same doc; story 4 persists it.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import {
  initDoc,
  snapshot,
  objectsSnapshot,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../shared/board-model.ts';
import {
  connectBoard,
  type BoardProvider,
  type ConnectionState,
  type ProviderFactory,
} from '../collab/connectBoard.ts';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  /**
   * Every object on the board, whatever its type (story 7): what the generic
   * rendering, selection, marquee and keyboard code reads. `notes` stays the
   * sticky-only view the story 2 components are typed against.
   */
  objects: readonly ObjectSnapshot[];
  /** Live collaboration status of the underlying provider. */
  connectionState: ConnectionState;
  /** The provider, exposed for the test hook's forced connect/disconnect. */
  provider: BoardProvider | null;
}

export function useBoardDoc(boardId: string, makeProvider?: ProviderFactory): BoardDoc {
  // One Y.Doc per component lifetime.
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const providerRef = useRef<BoardProvider | null>(null);

  // Attach the collaboration provider to the same doc. On unmount (or a board
  // change) we destroy it, closing the WebSocket and dropping any pending timer.
  useEffect(() => {
    const conn = connectBoard(doc, boardId, setConnectionState, makeProvider);
    providerRef.current = conn.provider;
    return () => {
      providerRef.current = null;
      conn.destroy();
    };
    // makeProvider is a stable module-level function in production; a test that
    // passes an inline factory re-attaches, which is fine.
  }, [doc, boardId, makeProvider]);

  // `version` bumps on any change; the snapshot is recomputed only when it
  // differs from `computed`. Keeps a stable object identity between changes
  // so useSyncExternalStore does not loop.
  const cache = useRef({ version: 0, computed: -1, value: [] as readonly StickySnapshot[] });
  // The objects view shares the `version` counter above; only its own `computed`
  // marker is separate.
  const objectsCache = useRef({ computed: -1, value: [] as readonly ObjectSnapshot[] });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const bump = () => {
        cache.current.version++;
        onStoreChange();
      };
      objects.observeDeep(bump);
      // Whole-doc changes (e.g. remote sync) must also invalidate.
      doc.on('update', bump);
      return () => {
        objects.unobserveDeep(bump);
        doc.off('update', bump);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    const c = cache.current;
    if (c.computed !== c.version) {
      c.value = snapshot(doc);
      c.computed = c.version;
    }
    return c.value;
  }, [doc]);

  const getObjects = useCallback((): readonly ObjectSnapshot[] => {
    const c = objectsCache.current;
    if (c.computed !== cache.current.version) {
      c.value = objectsSnapshot(doc);
      c.computed = cache.current.version;
    }
    return c.value;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const objects = useSyncExternalStore(subscribe, getObjects, getObjects);

  // The provider ref is stable for a given board; connectionState already drives
  // re-renders, so we deliberately do NOT include providerRef in the memo deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(
    () => ({ doc, notes, objects, connectionState, provider: providerRef.current }),
    [doc, notes, objects, connectionState],
  );
}
