import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState, type ProviderFactory } from '../sync/connectBoard';

/**
 * Owns the board document and turns it into an immutable React model.
 *
 * The Y.Doc is the single copy of the board on this screen. Story 3 attached a
 * network provider to the same document (live edits arrive as ordinary document
 * updates, so the rendering path is unchanged), and story 4 will persist it.
 */

export interface BoardDocState {
  readonly doc: Y.Doc;
  /** Notes in draw order (z, then id). Recomputed only when the doc changes. */
  readonly notes: readonly StickySnapshot[];
  /** Live connection state; `connected` when the board is local only. */
  readonly connectionState: ConnectionState;
}

export interface UseBoardDocOptions {
  /** Connect this document to a board room. Omit for a local-only document. */
  readonly boardId?: string;
  /** Injectable provider (component tests); defaults to the real one. */
  readonly providerFactory?: ProviderFactory;
}

/** A fresh board document, tagged with the schema version. */
export function createBoardDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/**
 * `useBoardDoc()` creates the document; passing one in lets a caller (tests)
 * supply an already filled document, and `options.boardId` attaches the live
 * room connection.
 */
export function useBoardDoc(provided?: Y.Doc, options: UseBoardDocOptions = {}): BoardDocState {
  const { boardId, providerFactory } = options;
  const [doc] = useState(() => provided ?? createBoardDoc());

  // The snapshot is memoised between changes so `useSyncExternalStore` sees a
  // stable reference and React does not re-render in a loop.
  const cacheRef = useRef<readonly StickySnapshot[] | null>(null);

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    const cached = cacheRef.current;
    if (cached !== null) {
      return cached;
    }
    const next = snapshot(doc);
    cacheRef.current = next;
    return next;
  }, [doc]);

  const subscribe = useCallback(
    (onChange: () => void): (() => void) => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const handler = (): void => {
        cacheRef.current = null;
        onChange();
      };
      objects.observeDeep(handler);
      cacheRef.current = null;
      return () => {
        objects.unobserveDeep(handler);
      };
    },
    [doc],
  );

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    boardId === undefined ? 'connected' : 'connecting',
  );

  // One provider per board: a board change or an unmount detaches it.
  useEffect(() => {
    if (boardId === undefined) {
      return;
    }
    const connection = connectBoard(doc, boardId, setConnectionState, { providerFactory });
    return () => {
      connection.destroy();
    };
  }, [doc, boardId, providerFactory]);

  return { doc, notes, connectionState };
}
