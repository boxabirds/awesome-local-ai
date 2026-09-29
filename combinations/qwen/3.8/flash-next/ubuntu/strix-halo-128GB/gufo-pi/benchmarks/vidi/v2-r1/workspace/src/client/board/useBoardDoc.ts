import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import * as Y from 'yjs';

import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type BoardConnection, type ConnectionState } from '../sync/connectBoard';

export interface BoardDoc {
  /** The shared document. Stories 3 and 4 attach a provider and storage to it. */
  doc: Y.Doc;
  /** Sticky notes to render, sorted by `(z, id)`; frozen between changes. */
  notes: readonly StickySnapshot[];
  /** Connection state of the live sync provider. */
  connectionState: ConnectionState;
}

/**
 * The one board document of this page, and a React view of it.
 *
 * The document is created once and never destroyed: this page *is* the board,
 * and React 19's StrictMode mounts effects twice in development, which would
 * otherwise tear down a document that is still in use.
 *
 * `snapshot(doc)` is recomputed only when the document actually changes
 * (`observeDeep` covers nested edits such as note text), and the previous array
 * is handed back in between so `useSyncExternalStore` sees a stable reference
 * and React does not loop.
 *
 * When a `boardId` is provided, a y-websocket provider is attached for live
 * collaboration. The provider is destroyed on unmount or board change.
 */
export function useBoardDoc(boardId?: string): BoardDoc {
  const [doc] = useState(() => {
    const created = new Y.Doc();
    initDoc(created);
    return created;
  });

  /** Cached snapshot; cleared by the observer, rebuilt by `getSnapshot`. */
  const cacheRef = useRef<readonly StickySnapshot[] | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');
      const observer = (): void => {
        cacheRef.current = null;
        onStoreChange();
      };
      objects.observeDeep(observer);
      return () => objects.unobserveDeep(observer);
    },
    [doc],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    if (cacheRef.current === null) cacheRef.current = snapshot(doc);
    return cacheRef.current;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Connection state
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    boardId ? 'connecting' : 'connected',
  );

  // Attach or detach the sync provider when boardId changes
  useEffect(() => {
    if (!boardId) {
      setConnectionState('connected');
      return undefined;
    }

    const connection: BoardConnection = connectBoard(doc, boardId, setConnectionState);
    return () => connection.destroy();
  }, [doc, boardId]);

  return useMemo(() => ({ doc, notes, connectionState }), [doc, notes, connectionState]);
}
