// Owns the local Y.Doc for the board and exposes an immutable, memoised
// snapshot to React via useSyncExternalStore. Story 3 attaches a network
// provider to the same doc; story 4 persists it.
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import {
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../shared/board-model.ts';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
}

export function useBoardDoc(): BoardDoc {
  // One Y.Doc per component lifetime.
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  // `version` bumps on any change; the snapshot is recomputed only when it
  // differs from `computed`. Keeps a stable object identity between changes
  // so useSyncExternalStore does not loop.
  const cache = useRef({ version: 0, computed: -1, value: [] as readonly StickySnapshot[] });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const bump = () => {
        cache.current.version++;
        onStoreChange();
      };
      objects.observeDeep(bump);
      // Whole-doc changes (e.g. remote sync in story 3) must also invalidate.
      doc.on('update', bump);
      return () => {
        objects.unobserveDeep(bump);
        doc.off('update', bump);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    const c = cache.current;
    if (c.computed !== c.version) {
      c.value = snapshot(doc);
      c.computed = c.version;
    }
    return c.value;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo(() => ({ doc, notes }), [doc, notes]);
}
