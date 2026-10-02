import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, OBJECTS_MAP, type StickySnapshot } from '../../shared/board-model';

export interface BoardDoc {
  /** The single shared document for this board (story 3 attaches a provider, story 4 persists it). */
  doc: Y.Doc;
  /** Immutable, (z, id)-sorted view of the known objects. */
  objects: readonly StickySnapshot[];
}

/**
 * Owns one `Y.Doc` for this page and exposes an immutable snapshot through
 * `useSyncExternalStore`. The snapshot is memoised and only recomputed when the
 * `objects` map (or anything inside it) changes.
 */
export function useBoardDoc(): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const cache = useRef<{ doc: Y.Doc; objects: readonly StickySnapshot[] }>({
    doc,
    objects: snapshot(doc),
  });

  const subscribe = useCallback(
    (onChange: () => void) => {
      const objects = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
      const handler = () => {
        // Recompute eagerly so getSnapshot stays referentially stable afterwards.
        cache.current = { doc, objects: snapshot(doc) };
        onChange();
      };
      objects.observeDeep(handler);
      return () => objects.unobserveDeep(handler);
    },
    [doc],
  );

  const getSnapshot = useCallback(() => {
    if (cache.current.doc !== doc) {
      cache.current = { doc, objects: snapshot(doc) };
    }
    return cache.current.objects;
  }, [doc]);

  const objects = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo(() => ({ doc, objects }), [doc, objects]);
}
