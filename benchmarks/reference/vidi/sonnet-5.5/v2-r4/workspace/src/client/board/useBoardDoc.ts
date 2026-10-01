import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

/** Owns the board Y.Doc (or adopts the one passed in) and exposes an immutable, memoised snapshot. */
export function useBoardDoc(external?: Y.Doc): { doc: Y.Doc; notes: readonly StickySnapshot[] } {
  const doc = useMemo(() => {
    const d = external ?? new Y.Doc();
    initDoc(d);
    return d;
  }, [external]);

  const cache = useRef<{ doc: Y.Doc; value: readonly StickySnapshot[] | null }>({ doc, value: null });
  if (cache.current.doc !== doc) cache.current = { doc, value: null };

  const subscribe = useCallback(
    (onChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        cache.current = { doc, value: null };
        onChange();
      };
      objects.observeDeep(handler);
      return () => objects.unobserveDeep(handler);
    },
    [doc],
  );
  const getSnapshot = useCallback(() => {
    if (cache.current.value === null) cache.current.value = snapshot(doc);
    return cache.current.value;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { doc, notes };
}
