import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot } from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';

export function useBoardDoc(): { doc: Y.Doc; notes: readonly StickySnapshot[] } {
  const doc = useMemo(() => {
    const d = new Y.Doc();
    initDoc(d);
    return d;
  }, []);
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
