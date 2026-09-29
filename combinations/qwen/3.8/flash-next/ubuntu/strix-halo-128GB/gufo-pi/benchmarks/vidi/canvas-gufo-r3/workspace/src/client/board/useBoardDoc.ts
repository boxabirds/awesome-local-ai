import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, StickySnapshot } from '@shared/board-model';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
}

/**
 * Owns one Y.Doc in memory (story 3 attaches a network provider, story 4 persists it).
 * Exposes an immutable snapshot via useSyncExternalStore, recomputed on
 * objects.observeDeep (and on mount, so mutations made during render are seen).
 */
export function useBoardDoc(): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (!docRef.current) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;
  const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;

  const cacheRef = useRef<{ snap: readonly StickySnapshot[]; version: number }>({
    snap: [],
    version: -1,
  });

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    // Yjs emits a stable `_item` structure version per map change; fall back to
    // comparing content so React never sees a changing reference for equal data.
    const next = snapshot(doc);
    const cache = cacheRef.current;
    if (cache.version === -1 || !snapshotsEqual(cache.snap, next)) {
      cacheRef.current = { snap: next, version: cache.version + 1 };
    }
    return cacheRef.current.snap;
  }, [doc]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const observer = () => onStoreChange();
      objects.observeDeep(observer);
      return () => objects.unobserveDeep(observer);
    },
    [objects],
  );

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo(() => ({ doc, notes }), [doc, notes]);
}

function snapshotsEqual(a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.x !== y.x ||
      x.y !== y.y ||
      x.color !== y.color ||
      x.text !== y.text ||
      x.z !== y.z ||
      x.createdAt !== y.createdAt
    ) {
      return false;
    }
  }
  return true;
}
