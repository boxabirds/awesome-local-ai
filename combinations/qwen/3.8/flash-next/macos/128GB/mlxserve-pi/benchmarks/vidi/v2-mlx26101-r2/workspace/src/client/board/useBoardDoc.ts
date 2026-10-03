import { useCallback, useMemo, useSyncExternalStore, useState, useEffect } from 'react';

import * as Y from 'yjs';

import { clearBoardTestHooks, registerBoardTestHooks } from '../canvas/testHooks.js';
import {
  DOC_OBJECTS_MAP,
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../shared/board-model.js';

/** What the hook exposes to the app. */
export interface UseBoardDocResult {
  /** The one document of this visit. Story 3 attaches a provider to it. */
  doc: Y.Doc;
  /** Every note, sorted by (z, id); a new array only when the doc changed. */
  notes: readonly StickySnapshot[];
}

/**
 * Snapshot cache per document, so `useSyncExternalStore` sees a stable value
 * between renders and recomputes only after an actual document change. Keyed
 * by the document (a WeakMap) rather than by the component, because React's
 * StrictMode renders the same document through two hook instances.
 */
const caches = new WeakMap<Y.Doc, { notes: readonly StickySnapshot[] | null }>();

const cacheFor = (doc: Y.Doc): { notes: readonly StickySnapshot[] | null } => {
  let cache = caches.get(doc);
  if (!cache) {
    cache = { notes: null };
    caches.set(doc, cache);
  }
  return cache;
};

/**
 * Owns the board's `Y.Doc` and republishes it as an immutable snapshot through
 * `useSyncExternalStore` (design `board.model`: "snapshot is memoised by
 * useBoardDoc and recomputed on objects.observeDeep").
 *
 * Nothing is synchronised or stored in this story: the document lives in memory
 * only, and reloads start empty. Story 3 adds a network provider and story 4
 * persists this same document, which is why the document - not React state -
 * is the source of truth for board content.
 */
export function useBoardDoc(): UseBoardDocResult {
  // useState's initialiser is the one place React guarantees runs once per
  // mounted component, so the document survives re-renders.
  const [doc] = useState<Y.Doc>(() => {
    const fresh = new Y.Doc();
    initDoc(fresh);
    return fresh;
  });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap<Y.Map<unknown>>(DOC_OBJECTS_MAP);
      const handler = () => {
        // Any change to any object (including a note's Y.Text) invalidates the
        // cached snapshot.
        cacheFor(doc).notes = null;
        onStoreChange();
      };
      objects.observeDeep(handler);
      return () => {
        objects.unobserveDeep(handler);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    const cache = cacheFor(doc);
    if (cache.notes === null) cache.notes = snapshot(doc);
    return cache.notes;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Test-only view of the document (test mode only): tests assert the document
  // itself, and can delete a note "through the model" the way a second client
  // would, instead of only looking at the rendered DOM.
  useEffect(() => {
    registerBoardTestHooks({
      getDoc: () => doc,
      getNotes: () => snapshot(doc),
    });
    return () => clearBoardTestHooks();
  }, [doc]);

  return useMemo<UseBoardDocResult>(() => ({ doc, notes }), [doc, notes]);
}
