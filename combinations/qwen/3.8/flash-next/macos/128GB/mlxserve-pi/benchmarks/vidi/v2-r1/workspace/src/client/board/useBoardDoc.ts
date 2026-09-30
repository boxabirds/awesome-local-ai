import { useCallback, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import {
  initDoc,
  snapshot,
  snapshotObjects,
  type BoardObject,
  type StickySnapshot,
} from '../../shared/board-model';
import {
  connectBoard,
  useConnectionState,
  type ConnectionState,
  type ConnectionStateTracker,
} from '../sync/connectBoard';

export interface UseBoardDocResult {
  /** The single in-memory Y.Doc this client owns (story 3 attaches a provider,
   * story 4 persists the very same document). */
  readonly doc: Y.Doc;
  /** Every sticky note, sorted by (z, id) ascending; recomputed on change. */
  readonly notes: readonly StickySnapshot[];
  /**
   * Every object of every kind the board can draw and select, in draw order. Story 7
   * selects, moves and resizes objects rather than notes only, so the whole document
   * is what the selection works over; a kind this screen does not know is not in it.
   */
  readonly objects: readonly BoardObject[];
  /** State of the live connection to this board's room. */
  readonly connectionState: ConnectionState;
}

/** Both views of the document, cached together so one change refreshes both. */
interface BoardCache {
  notes: readonly StickySnapshot[];
  objects: readonly BoardObject[];
}

/**
 * Owns one `Y.Doc`, initialises the board schema, and exposes an immutable
 * snapshot of the notes through `useSyncExternalStore`. The snapshot is
 * memoised and only recomputed when the objects map changes (observeDeep), so
 * unrelated renders return the identical array reference.
 *
 * The doc is connected to `boardId`'s room for as long as the hook lives, so a
 * remote change re-renders through the same `observeDeep` path as a local one;
 * the provider is destroyed when the board id changes or the board unmounts.
 */
export function useBoardDoc(boardId: string): UseBoardDocResult {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const cacheRef = useRef<BoardCache | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const handler = (): void => {
        cacheRef.current = null;
        onStoreChange();
      };
      objects.observeDeep(handler);
      return () => {
        objects.unobserveDeep(handler);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback((): BoardCache => {
    if (cacheRef.current === null) {
      cacheRef.current = { notes: snapshot(doc), objects: snapshotObjects(doc) };
    }
    return cacheRef.current;
  }, [doc]);

  const cache = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const connectionState = useConnectionState(
    useCallback(
      (sink: ConnectionStateTracker): (() => void) => {
        const connection = connectBoard(doc, boardId, sink);
        return () => connection.destroy();
      },
      [doc, boardId],
    ),
  );

  return { doc, notes: cache.notes, objects: cache.objects, connectionState };
}
