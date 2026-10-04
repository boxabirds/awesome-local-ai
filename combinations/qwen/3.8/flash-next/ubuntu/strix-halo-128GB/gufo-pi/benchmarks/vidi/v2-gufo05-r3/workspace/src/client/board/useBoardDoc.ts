import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface BoardDocApi {
  /** The single Yjs document backing the board (story 3 attaches a provider). */
  doc: Y.Doc;
  /** Board objects in render order `(z, id)`; unknown types are skipped. */
  notes: readonly StickySnapshot[];
}

/**
 * Owns the board's `Y.Doc` and exposes it to React as an immutable snapshot.
 *
 * The document is created once per mount and `initDoc` runs on it. Changes are
 * observed with `objects.observeDeep`; the snapshot itself is memoised and
 * handed to `useSyncExternalStore`, so React re-renders at most once per batch
 * of Yjs changes and always reads a stable array reference between changes.
 *
 * The document is deliberately *not* destroyed on unmount: story 3 attaches a
 * network provider and story 4 persists the same document, and React's
 * StrictMode double-mount must not discard board content.
 */
export function useBoardDoc(existing?: Y.Doc): BoardDocApi {
  const [created] = useState<Y.Doc>(() => {
    const doc = new Y.Doc();
    initDoc(doc);
    return doc;
  });
  const doc = existing ?? created;

  const cache = useRef<{ dirty: boolean; value: readonly StickySnapshot[] }>({
    dirty: true,
    value: [],
  });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');
      const observer = () => {
        cache.current.dirty = true;
        onStoreChange();
      };
      objects.observeDeep(observer);
      // Pick up changes made between the render and this subscription.
      cache.current.dirty = true;
      return () => objects.unobserveDeep(observer);
    },
    [doc],
  );

  const getSnapshot = useCallback(() => {
    if (cache.current.dirty) {
      cache.current = { dirty: false, value: snapshot(doc) };
    }
    return cache.current.value;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { doc, notes };
}
