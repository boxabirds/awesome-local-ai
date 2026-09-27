import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model.js';

export interface BoardDoc {
  /** The live Yjs document every mutation and (from story 3) the provider attach to. */
  readonly doc: Y.Doc;
  /**
   * An immutable snapshot of every sticky note, sorted by (z, id). It is recomputed
   * only when the document actually changes, so React re-renders on content edits.
   */
  readonly notes: readonly StickySnapshot[];
}

/**
 * Owns the board's single `Y.Doc` and exposes an immutable snapshot of its sticky
 * notes to React through `useSyncExternalStore`.
 *
 * The document is created once for the lifetime of the component tree and prepared
 * with `initDoc` (which sets `meta.schemaVersion`). Snapshot invalidation listens to
 * `objects.observeDeep`, so it fires for note add/remove, for a moved/repainted field,
 * and for text edits inside a note's `Y.Text` — but not for the `meta` map. Story 3
 * only needs to attach a network provider to the returned `doc`.
 */
export function useBoardDoc(): BoardDoc {
  // One document for the whole component lifetime; StrictMode's double-invoke of the
  // initialiser would otherwise create two docs, so keep it in a ref guarded by lazy init.
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) docRef.current = new Y.Doc();
  const doc = docRef.current;

  // The snapshot cache. `getSnapshot` must return a stable reference between calls
  // unless the underlying data changed, so React does not loop; it is refreshed only
  // inside the observer and returned as-is from `getSnapshot`.
  const cacheRef = useRef<readonly StickySnapshot[]>(snapshot(doc));
  const listenersRef = useRef<Set<() => void>>(new Set());

  // Recompute once on mount in case the document changed before the observer ran
  // (e.g. `initDoc` already ran). `initDoc` is idempotent, so a warm document is safe.
  useEffect(() => {
    initDoc(doc);
    cacheRef.current = snapshot(doc);
  }, [doc]);

  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      const listeners = listenersRef.current;
      listeners.add(onStoreChange);
      const objects = doc.getMap('objects');
      const observer = (): void => {
        cacheRef.current = snapshot(doc);
        for (const listener of listeners) listener();
      };
      objects.observeDeep(observer);
      return () => {
        listeners.delete(onStoreChange);
        objects.unobserveDeep(observer);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => cacheRef.current, []);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Identity is stable while the cached array is unchanged; memo is a no-op guard so a
  // future provider that re-subscribes does not churn the returned object.
  const value = useMemo<BoardDoc>(() => ({ doc, notes }), [doc, notes]);

  return value;
}
