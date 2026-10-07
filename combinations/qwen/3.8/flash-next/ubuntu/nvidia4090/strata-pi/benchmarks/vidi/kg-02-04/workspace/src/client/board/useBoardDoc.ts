import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as Y from "yjs";
import { initDoc, objectsMap, snapshot, type StickySnapshot } from "../../shared/board-model";
import { isTestMode } from "../canvas/testHooks";

/**
 * The board document, and the React view of it.
 *
 * `useBoardDoc` owns one `Y.Doc` (in memory in this story) and exposes an
 * immutable `snapshot()` of it through `useSyncExternalStore`. Story 3 only has
 * to attach a network provider to `doc` and story 4 only has to persist the
 * same document — nothing else in the app changes, which is why notes live in
 * Yjs from day one.
 */
export interface BoardDoc {
  readonly doc: Y.Doc;
  /** Board objects, sorted by (z, id); objects of unknown types are skipped. */
  readonly notes: readonly StickySnapshot[];
}

/**
 * Test-only hook (same rule as `window.__vidi6`): tests inspect and change the
 * real document instead of going through the UI, which is how a note deleted
 * "by someone else" is simulated.
 */
export interface Vidi6BoardTestApi {
  readonly doc: Y.Doc;
  snapshot(): readonly StickySnapshot[];
}

declare global {
  interface Window {
    __vidi6Board?: Vidi6BoardTestApi;
  }
}

export function useBoardDoc(): BoardDoc {
  // Lazy state init rather than a mutable ref: it survives a StrictMode double
  // render. The document is deliberately *not* destroyed on unmount — a
  // StrictMode remount must find the same board, and story 4 owns persistence.
  const [doc] = useState<Y.Doc>(() => {
    const created = new Y.Doc();
    initDoc(created);
    return created;
  });

  /**
   * `getSnapshot` must return the identical value until something actually
   * changes, otherwise React re-renders forever, so the snapshot is memoised
   * against a version counter that every Yjs change bumps.
   */
  const versionRef = useRef(0);
  const cacheRef = useRef<{ version: number; notes: readonly StickySnapshot[] }>({
    version: -1,
    notes: [],
  });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = objectsMap(doc);
      const handler = () => {
        versionRef.current += 1;
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
    const cache = cacheRef.current;
    if (cache.version !== versionRef.current) {
      cache.version = versionRef.current;
      cache.notes = snapshot(doc);
    }
    return cache.notes;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!isTestMode()) return;
    const previous = window.__vidi6Board;
    window.__vidi6Board = { doc, snapshot: () => snapshot(doc) };
    return () => {
      window.__vidi6Board = previous;
    };
  }, [doc]);

  return { doc, notes };
}
