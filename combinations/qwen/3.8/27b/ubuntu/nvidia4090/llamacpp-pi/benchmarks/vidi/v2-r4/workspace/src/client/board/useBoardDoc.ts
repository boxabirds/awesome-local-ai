/**
 * Owns the in-memory `Y.Doc` for this page and exposes an immutable,
 * memoised snapshot of the board to React via `useSyncExternalStore`.
 *
 * The document lives for the lifetime of the app in this story (nothing is
 * persisted). Story 3 attaches a network provider to the same document and
 * story 4 persists it; neither changes this hook's snapshot contract.
 *
 * Pass an existing `Y.Doc` (already initialised with `initDoc`) to share a
 * document between the app and a test.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as Y from "yjs";
import {
  initDoc,
  snapshot,
  type StickySnapshot,
} from "../../shared/board-model";

export interface BoardDoc {
  /** The in-memory Y.Doc that owns the board. */
  doc: Y.Doc;
  /** Immutable note snapshots, sorted by (z, id). Stable reference between changes. */
  notes: readonly StickySnapshot[];
}

export function useBoardDoc(existingDoc?: Y.Doc): BoardDoc {
  const createdRef = useRef<Y.Doc | null>(null);
  if (!existingDoc && createdRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    createdRef.current = doc;
  }
  const doc = existingDoc ?? createdRef.current!;

  const listenersRef = useRef(new Set<() => void>());
  const versionRef = useRef(0);
  const cacheRef = useRef<{ version: number; value: readonly StickySnapshot[] } | null>(null);

  // Recompute the memoised snapshot exactly when the objects map changes.
  useEffect(() => {
    const objects = doc.getMap("objects");
    const onChange = () => {
      versionRef.current += 1;
      for (const listener of listenersRef.current) listener();
    };
    objects.observeDeep(onChange);
    return () => {
      objects.unobserveDeep(onChange);
    };
  }, [doc]);

  const subscribe = useCallback((onChange: () => void) => {
    listenersRef.current.add(onChange);
    return () => {
      listenersRef.current.delete(onChange);
    };
  }, []);

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    const version = versionRef.current;
    const cache = cacheRef.current;
    if (cache && cache.version === version) return cache.value;
    const value = snapshot(doc);
    cacheRef.current = { version, value };
    return value;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot);
  return { doc, notes };
}
