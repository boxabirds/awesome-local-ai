import { useMemo, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

/**
 * Owns the Y.Doc and exposes an immutable snapshot via useSyncExternalStore.
 * Story 3 will attach a network provider here; story 4 will persist it.
 */
export function useBoardDoc(): { doc: Y.Doc; notes: readonly StickySnapshot[] } {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  // Cache the snapshot so getSnapshot returns a stable reference
  // until the doc actually changes.
  const snapshotCacheRef = useRef<{ version: number; value: readonly StickySnapshot[] }>({
    version: -1,
    value: [],
  });
  const versionRef = useRef(0);

  const subscribe = useMemo(() => {
    return (callback: () => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        versionRef.current++;
        callback();
      };
      objects.observeDeep(handler);
      return () => {
        objects.unobserveDeep(handler);
      };
    };
  }, [doc]);

  const getSnapshot = useMemo(() => {
    return () => {
      const cache = snapshotCacheRef.current;
      if (cache.version === versionRef.current) {
        return cache.value;
      }
      const value = snapshot(doc);
      snapshotCacheRef.current = { version: versionRef.current, value };
      return value;
    };
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { doc, notes };
}
