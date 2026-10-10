import { useMemo, useSyncExternalStore } from 'react';
import * as Y from 'yjs';

import { initDoc, OBJECTS_KEY, snapshot } from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';

/** What the hook exposes: the live document plus an immutable render view. */
export interface BoardDoc {
  /** The document every mutation goes through (story 3 attaches a provider). */
  readonly doc: Y.Doc;
  /** Notes sorted by (z, id); recomputed only when the doc changes. */
  readonly notes: readonly StickySnapshot[];
}

/**
 * Owns one local `Y.Doc` and re-renders the React tree from it.
 *
 * `objects.observeDeep` invalidates the memoised `snapshot`; React pulls the
 * new value through `useSyncExternalStore`, so renders always see a consistent
 * immutable view (story 3 only needs to add the network provider to the same
 * document, and story 4 persistence).
 */
export function useBoardDoc(external?: Y.Doc): BoardDoc {
  const doc = useMemo(() => {
    const created = external ?? new Y.Doc();
    initDoc(created);
    return created;
  }, [external]);

  const store = useMemo(() => {
    let cached: readonly StickySnapshot[] | undefined;
    const objects = doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
    return {
      subscribe(onChange: () => void): () => void {
        const invalidate = (): void => {
          cached = undefined;
          onChange();
        };
        objects.observeDeep(invalidate);
        return () => objects.unobserveDeep(invalidate);
      },
      getSnapshot(): readonly StickySnapshot[] {
        if (cached === undefined) cached = snapshot(doc);
        return cached;
      },
    };
  }, [doc]);

  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { doc, notes };
}
