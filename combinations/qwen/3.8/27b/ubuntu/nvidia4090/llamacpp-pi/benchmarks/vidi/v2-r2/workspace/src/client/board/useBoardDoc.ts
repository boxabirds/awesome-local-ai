import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

/**
 * Owns the in-memory Y.Doc for the board and exposes an immutable snapshot
 * of all objects via useSyncExternalStore.
 *
 * Story 3 will attach a network provider to the same document and story 4
 * will persist it; the snapshot path does not change. The snapshot is
 * memoised per document revision and recomputed on objects.observeDeep.
 */
export function useBoardDoc(): { doc: Y.Doc; objects: readonly StickySnapshot[] } {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  // Bumped on every document change; getSnapshot recomputes only when it
  // changes, so useSyncExternalStore always gets a stable reference.
  const versionRef = useRef(0);
  const cacheRef = useRef<{ version: number; objects: readonly StickySnapshot[] } | null>(null);

  useEffect(() => {
    const objects = doc.getMap('objects');
    const onChange = (): void => {
      versionRef.current += 1;
    };
    objects.observeDeep(onChange);
    return () => {
      objects.unobserveDeep(onChange);
    };
  }, [doc]);

  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      const objects = doc.getMap('objects');
      objects.observeDeep(onStoreChange);
      return () => {
        objects.unobserveDeep(onStoreChange);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    const version = versionRef.current;
    const cache = cacheRef.current;
    if (cache === null || cache.version !== version) {
      cacheRef.current = { version, objects: snapshot(doc) };
      return cacheRef.current.objects;
    }
    return cache.objects;
  }, [doc]);

  const objects = useSyncExternalStore(subscribe, getSnapshot);

  return { doc, objects };
}
