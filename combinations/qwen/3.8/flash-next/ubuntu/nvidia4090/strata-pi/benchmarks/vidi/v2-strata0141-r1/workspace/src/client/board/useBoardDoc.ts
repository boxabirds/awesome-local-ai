import { useCallback, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

/**
 * The board document and its render model.
 *
 * One `Y.Doc` per mounted board (in this story it lives only in memory; story 3
 * attaches a provider to this same doc and story 4 persists it). `snapshot()` is
 * memoised and recomputed only when the document actually changes, and it is
 * exposed through `useSyncExternalStore` so React renders a consistent,
 * immutable view.
 */
export interface BoardDoc {
  readonly doc: Y.Doc;
  readonly notes: readonly StickySnapshot[];
}

const EMPTY: readonly StickySnapshot[] = Object.freeze([] as StickySnapshot[]);

export function useBoardDoc(providedDoc?: Y.Doc): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = providedDoc ?? new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  // `null` means "dirty": the next read recomputes the snapshot.
  const cacheRef = useRef<readonly StickySnapshot[] | null>(null);

  const subscribe = useCallback(
    (listener: () => void) => {
      const objects = doc.getMap<unknown>('objects');
      const handler = () => {
        cacheRef.current = null;
        listener();
      };
      // observeDeep also fires for nested Y.Text changes (typing on a note).
      objects.observeDeep(handler);
      return () => {
        objects.unobserveDeep(handler);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    let notes = cacheRef.current;
    if (notes === null) {
      notes = snapshot(doc);
      cacheRef.current = notes;
    }
    return notes;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  return { doc, notes };
}
