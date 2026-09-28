import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

/**
 * Owns the board document and publishes it to React.
 *
 * The `Y.Doc` is created once per hook instance and never replaced; every
 * mutation flows through `src/shared/board-model`. `objects.observeDeep`
 * recomputes an immutable `snapshot()` which React reads through
 * `useSyncExternalStore`, so renders stay consistent with the document even
 * when Yjs updates arrive from inside an event handler.
 *
 * `useSyncExternalStore` compares snapshots by identity, so the snapshot is
 * cached in a ref and only recomputed when the document actually changes —
 * two renders with an unchanged document return the same array.
 *
 * Story 3 attaches a network provider to the same document; story 4 persists
 * it. Neither changes this hook's contract.
 */
export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
}

export function useBoardDoc(): BoardDoc {
  // One document per hook instance (one page in this story).
  const doc = useMemo(() => {
    const created = new Y.Doc();
    initDoc(created);
    return created;
  }, []);

  const cache = useRef<readonly StickySnapshot[] | null>(null);
  if (cache.current === null) cache.current = snapshot(doc);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const observer = () => {
        cache.current = snapshot(doc);
        onStoreChange();
      };
      objects.observeDeep(observer);
      return () => objects.unobserveDeep(observer);
    },
    [doc],
  );

  const getSnapshot = useCallback(() => cache.current!, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { doc, notes };
}
