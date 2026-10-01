import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

/** Owns the board's Y.Doc (or adopts `existing`, used by tests) and exposes an immutable snapshot. */
export function useBoardDoc(existing?: Y.Doc): { doc: Y.Doc; notes: readonly StickySnapshot[] } {
  const doc = useMemo(() => {
    const d = existing ?? new Y.Doc();
    initDoc(d);
    return d;
  }, [existing]);
  const cache = useRef<readonly StickySnapshot[] | null>(null);

  const subscribe = useCallback(
    (onChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        cache.current = null;
        onChange();
      };
      objects.observeDeep(handler);
      return () => objects.unobserveDeep(handler);
    },
    [doc],
  );
  const getSnapshot = useCallback(() => (cache.current ??= snapshot(doc)), [doc]);
  const notes = useSyncExternalStore(subscribe, getSnapshot);
  return { doc, notes };
}
