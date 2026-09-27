import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Doc } from 'yjs';

import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

export interface BoardDoc {
  /** The single in-memory document, shared with the provider. */
  doc: Doc;
  /** Sticky notes in render order `(z, id)`; immutable, memoised snapshot. */
  notes: readonly StickySnapshot[];
  /** Live connection state for the status badge. */
  connectionState: ConnectionState;
}

/**
 * Owns one `Y.Doc` for the board and exposes an immutable snapshot of its notes
 * through `useSyncExternalStore`. The snapshot is recomputed only when the
 * `objects` map (or anything under it) changes, so React re-renders on real
 * edits and never tears mid-transaction (Yjs fires observers after a
 * transaction commits).
 *
 * A remote change arrives with the provider as the transaction origin and
 * re-renders through the very same observer as a local one — there is no
 * separate "remote update" path, which is why nobody's screen has to refresh.
 */
export function useBoardDoc(boardId: string): BoardDoc {
  const docRef = useRef<Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  // The value handed to useSyncExternalStore must be referentially stable
  // between store changes, so it lives in a ref and is only rebuilt in the
  // observer, never on an unrelated render.
  const cacheRef = useRef<readonly StickySnapshot[]>(snapshot(doc));

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        cacheRef.current = snapshot(doc);
        onStoreChange();
      };
      objects.observeDeep(handler);
      return () => objects.unobserveDeep(handler);
    },
    [doc],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => cacheRef.current, []);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  // One provider per board; switching boards (or unmounting the page) tears the
  // socket down instead of leaving it running behind the new board.
  useEffect(() => {
    const connection = connectBoard(doc, boardId, setConnectionState);
    return () => connection.destroy();
  }, [doc, boardId]);

  return { doc, notes, connectionState };
}
