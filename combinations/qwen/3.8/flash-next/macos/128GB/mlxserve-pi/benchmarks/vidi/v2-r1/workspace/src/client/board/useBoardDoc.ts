import { useCallback, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface UseBoardDocResult {
  /** The single in-memory Y.Doc this client owns (story 3 attaches a provider,
   * story 4 persists the very same document). */
  readonly doc: Y.Doc;
  /** Every sticky note, sorted by (z, id) ascending; recomputed on change. */
  readonly notes: readonly StickySnapshot[];
}

/**
 * Owns one `Y.Doc`, initialises the board schema, and exposes an immutable
 * snapshot of the notes through `useSyncExternalStore`. The snapshot is
 * memoised and only recomputed when the objects map changes (observeDeep), so
 * unrelated renders return the identical array reference.
 */
export function useBoardDoc(): UseBoardDocResult {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const cacheRef = useRef<readonly StickySnapshot[] | null>(null);

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

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    if (cacheRef.current === null) cacheRef.current = snapshot(doc);
    return cacheRef.current;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { doc, notes };
}
