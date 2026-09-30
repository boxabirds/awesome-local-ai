import { useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { type StickySnapshot, initDoc, objectsMap, snapshot } from '../../shared/board-model';

interface BoardStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly StickySnapshot[];
}

/** Memoised snapshot of `doc`, recomputed only after the objects change. */
function createBoardStore(doc: Y.Doc): BoardStore {
  let cached: readonly StickySnapshot[] | null = null;
  const listeners = new Set<() => void>();
  objectsMap(doc).observeDeep(() => {
    cached = null;
    for (const listener of listeners) listener();
  });
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      cached ??= snapshot(doc);
      return cached;
    },
  };
}

/**
 * Owns the board's Y.Doc (in memory in this story; story 3 attaches a provider,
 * story 4 persists it) and exposes an immutable, memoised snapshot of its notes.
 */
export function useBoardDoc(existing?: Y.Doc): { doc: Y.Doc; notes: readonly StickySnapshot[] } {
  const [store] = useState(() => {
    const doc = existing ?? new Y.Doc();
    initDoc(doc);
    return { doc, ...createBoardStore(doc) };
  });
  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { doc: store.doc, notes };
}
