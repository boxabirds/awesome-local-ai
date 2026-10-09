import { useCallback, useEffect, useSyncExternalStore, useRef, useState } from 'react';
import * as Y from 'yjs';
import {
  OBJECTS_MAP,
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import { registerTestHooks } from '../canvas/testHooks';

export interface BoardDoc {
  /** The single document this page edits (story 3 attaches a provider to it). */
  readonly doc: Y.Doc;
  /** Sticky notes to render, sorted by `(z, id)`; unknown object types are skipped. */
  readonly notes: readonly StickySnapshot[];
}

/**
 * Owns the board's `Y.Doc` and exposes it as an immutable snapshot.
 *
 * `useSyncExternalStore` needs a cached snapshot, so the array is recomputed only when
 * `objects.observeDeep` fires — which includes nested `Y.Text` changes, which is how a
 * note's text reaches React while someone types. Nothing here is persisted or synced
 * yet: stories 3 and 4 attach a provider and storage to the same document.
 */
export function useBoardDoc(): BoardDoc {
  const [doc] = useState<Y.Doc>(() => {
    const fresh = new Y.Doc();
    initDoc(fresh);
    return fresh;
  });
  const objects = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);

  // Cached by hand: `snapshot()` allocates, and returning a new array on every call
  // would make `useSyncExternalStore` re-render forever.
  const cache = useRef<{ snapshot: readonly StickySnapshot[] } | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      const observer = (): void => {
        cache.current = null;
        onStoreChange();
      };
      objects.observeDeep(observer);
      return () => {
        cache.current = null;
        objects.unobserveDeep(observer);
      };
    },
    [objects],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    if (!cache.current) cache.current = { snapshot: snapshot(doc) };
    return cache.current.snapshot;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // The component and e2e tests assert the document itself (and story 3 needs the same
  // hook point), so it is exposed through the test-only hook.
  useEffect(() => {
    registerTestHooks({ boardDoc: () => doc });
  }, [doc]);

  return { doc, notes };
}
