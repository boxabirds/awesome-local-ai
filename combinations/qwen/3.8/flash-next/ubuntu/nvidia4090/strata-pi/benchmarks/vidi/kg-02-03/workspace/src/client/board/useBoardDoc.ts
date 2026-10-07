import { useState, useSyncExternalStore } from "react";
import * as Y from "yjs";
import {
  OBJECTS_MAP,
  initDoc,
  snapshot,
  type StickySnapshot,
} from "../../shared/board-model";

/**
 * The board document and the render model derived from it.
 *
 * One `Y.Doc` per page owns every board object (story 3 attaches a network
 * provider to this same document, story 4 persists it). React never reads the
 * Yjs structures directly: it subscribes to an immutable `snapshot()` that is
 * recomputed only when the document changes, through `useSyncExternalStore`.
 */

export interface BoardStore {
  subscribe(onStoreChange: () => void): () => void;
  getSnapshot(): readonly StickySnapshot[];
}

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  store: BoardStore;
}

/**
 * A `useSyncExternalStore` store over one Y.Doc: observes `objects` deeply,
 * memoises the snapshot and notifies subscribers only when something actually
 * changed. Observing starts with the first subscriber and stops with the last,
 * so remounts (React StrictMode) re-attach cleanly.
 */
export function createBoardStore(doc: Y.Doc): BoardStore {
  const map = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
  const listeners = new Set<() => void>();
  let current: readonly StickySnapshot[] = snapshot(doc);
  let observing = false;

  const onChange = () => {
    const next = snapshot(doc);
    if (next === current) return;
    current = next;
    for (const listener of listeners) listener();
  };

  return {
    subscribe(onStoreChange) {
      if (!observing) {
        map.observeDeep(onChange);
        observing = true;
      }
      // Catch anything that changed while nobody was subscribed.
      current = snapshot(doc);
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
        if (listeners.size === 0 && observing) {
          map.unobserveDeep(onChange);
          observing = false;
        }
      };
    },
    getSnapshot: () => current,
  };
}

/**
 * Owns the page's `Y.Doc` (or adopts an existing one, which is how component
 * tests assert on the model) and returns the current immutable snapshot.
 */
export function useBoardDoc(existingDoc?: Y.Doc): BoardDoc {
  const [state] = useState(() => {
    const doc = existingDoc ?? new Y.Doc();
    initDoc(doc);
    return { doc, store: createBoardStore(doc) };
  });

  const notes = useSyncExternalStore(
    state.store.subscribe,
    state.store.getSnapshot,
    state.store.getSnapshot,
  );

  return { doc: state.doc, notes, store: state.store };
}
