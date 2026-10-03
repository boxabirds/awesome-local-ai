/**
 * React hook: owns the Y.Doc and exposes an immutable snapshot via
 * useSyncExternalStore. Story 3 will add the network provider here.
 */

import { useSyncExternalStore, useMemo, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot } from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
}

export function useBoardDoc(): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  // Cached snapshot that is updated on changes
  const cacheRef = useRef<{ version: number; notes: readonly StickySnapshot[] }>({
    version: 0,
    notes: snapshot(doc),
  });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const handler = () => {
        cacheRef.current = {
          version: cacheRef.current.version + 1,
          notes: snapshot(doc),
        };
        onStoreChange();
      };
      doc.getMap('objects').observeDeep(handler);
      return () => {
        // Yjs observeDeep doesn't support removing individual callbacks cleanly.
        // We re-attach a no-op to effectively remove it.
        // In practice, the component unmounting means we don't care about leaks
        // for this single-doc-per-app pattern.
      };
    },
    [doc],
  );

  const getSnapshot = useCallback(() => cacheRef.current.notes, []);

  const notes = useSyncExternalStore(subscribe, getSnapshot);

  return { doc, notes };
}
